import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { BalanceDriftScheduler } from '../../src/workers/balance-drift.scheduler.js';
import { BalanceDriftProcessor } from '../../src/workers/balance-drift.processor.js';
import { registry } from '../../src/observability/metrics.js';

describe('BalanceDriftScheduler', () => {
    let processor: {
        sweep: ReturnType<typeof vi.fn>;
    };

    let scheduler: BalanceDriftScheduler;
    let lease: {
        acquire: ReturnType<typeof vi.fn>;
        renew: ReturnType<typeof vi.fn>;
        release: ReturnType<typeof vi.fn>;
    };

    beforeEach(() => {
        vi.useFakeTimers();

        registry.resetMetrics();

        processor = {
            sweep: vi.fn().mockResolvedValue(0),
        };

        lease = {
            acquire: vi.fn().mockResolvedValue(true),
            renew: vi.fn().mockResolvedValue(true),
            release: vi.fn().mockResolvedValue(undefined),
        };

        scheduler = new BalanceDriftScheduler(
            processor as unknown as BalanceDriftProcessor,
            lease,
            300_000,
        );
    });

    afterEach(async () => {
        await scheduler.stop();
        vi.useRealTimers();
    });

    it('should start the scheduler', () => {
        scheduler.start();

        expect(processor.sweep).not.toHaveBeenCalled();
    });

    it('should not start more than once', async () => {
        scheduler.start();
        scheduler.start();

        await vi.advanceTimersByTimeAsync(300_000);

        expect(processor.sweep).toHaveBeenCalledTimes(1);
    });

    it('should skip execution when another worker owns the lease', async () => {
        lease.acquire.mockResolvedValueOnce(false);

        scheduler.start();

        await vi.advanceTimersByTimeAsync(300_000);

        expect(processor.sweep).not.toHaveBeenCalled();
        expect(lease.release).not.toHaveBeenCalled();
    });

    it('should prevent overlapping executions', async () => {
        let resolveProcessing!: () => void;

        processor.sweep.mockReturnValueOnce(
            new Promise<unknown>((resolve) => {
                resolveProcessing = () => resolve({ checked: 1 });
            }),
        );

        scheduler.start();

        // First execution starts.
        await vi.advanceTimersByTimeAsync(300_000);

        expect(processor.sweep).toHaveBeenCalledTimes(1);

        // Next interval occurs while the first execution is still running.
        await vi.advanceTimersByTimeAsync(300_000);

        expect(processor.sweep).toHaveBeenCalledTimes(1);

        resolveProcessing();

        await vi.runOnlyPendingTimersAsync();
    });

    it('should stop scheduling new executions', async () => {
        scheduler.start();

        await vi.advanceTimersByTimeAsync(300_000);

        expect(processor.sweep).toHaveBeenCalledTimes(1);

        await scheduler.stop();

        await vi.advanceTimersByTimeAsync(600_000);

        expect(processor.sweep).toHaveBeenCalledTimes(1);
    });

    it('should be safe to stop before starting', async () => {
        await expect(scheduler.stop()).resolves.toBeUndefined();

        await vi.advanceTimersByTimeAsync(600_000);

        expect(processor.sweep).not.toHaveBeenCalled();
    });

    it('should recover after processor failure', async () => {
        processor.sweep.mockRejectedValueOnce(new Error('sweep failed')).mockResolvedValueOnce(3);

        scheduler.start();

        // First run fails.
        await vi.advanceTimersByTimeAsync(300_000);

        expect(processor.sweep).toHaveBeenCalledTimes(1);

        // The scheduler should remain alive and permit the next run.
        await vi.advanceTimersByTimeAsync(300_000);

        expect(processor.sweep).toHaveBeenCalledTimes(2);
    });

    it('records worker_cycles_total for every attempt and worker_failures_total only for the failed one', async () => {
        processor.sweep.mockRejectedValueOnce(new Error('sweep failed')).mockResolvedValueOnce(3);

        scheduler.start();

        await vi.advanceTimersByTimeAsync(300_000);
        await vi.advanceTimersByTimeAsync(300_000);

        const metrics = await registry.metrics();

        expect(metrics).toContain('worker_cycles_total{worker_name="balance-drift-scheduler"} 2');
        expect(metrics).toContain('worker_failures_total{worker_name="balance-drift-scheduler"} 1');
        expect(metrics).toContain(
            'worker_duration_seconds_count{worker_name="balance-drift-scheduler"} 2',
        );
    });

    it('does not record a cycle when the lease was not acquired', async () => {
        lease.acquire.mockResolvedValueOnce(false);

        scheduler.start();

        await vi.advanceTimersByTimeAsync(300_000);

        const metrics = await registry.metrics();

        expect(metrics).not.toContain('worker_cycles_total{worker_name="balance-drift-scheduler"}');
    });

    it('should allow restarting after stop', async () => {
        scheduler.start();

        await vi.advanceTimersByTimeAsync(300_000);

        expect(processor.sweep).toHaveBeenCalledTimes(1);

        await scheduler.stop();

        scheduler.start();

        await vi.advanceTimersByTimeAsync(300_000);

        expect(processor.sweep).toHaveBeenCalledTimes(2);
    });
});
