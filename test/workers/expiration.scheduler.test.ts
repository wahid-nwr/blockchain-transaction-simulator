import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { ExpirationScheduler } from '../../src/workers/expiration.scheduler.js';
import { ExpirationProcessor } from '../../src/workers/expiration.processor.js';
import { CONFIRMATION_TIMEOUT_MS } from '../../src/domain/transaction/transaction-expiration.js';
import { registry } from '../../src/observability/metrics.js';

describe('ExpirationScheduler', () => {
    let processor: {
        processExpiredTransactions: ReturnType<typeof vi.fn>;
    };

    let scheduler: ExpirationScheduler;
    let lease: {
        acquire: ReturnType<typeof vi.fn>;
        renew: ReturnType<typeof vi.fn>;
        release: ReturnType<typeof vi.fn>;
    };

    beforeEach(() => {
        vi.useFakeTimers();

        registry.resetMetrics();

        processor = {
            processExpiredTransactions: vi.fn().mockResolvedValue(0),
        };

        lease = {
            acquire: vi.fn().mockResolvedValue(true),
            renew: vi.fn().mockResolvedValue(true),
            release: vi.fn().mockResolvedValue(undefined),
        };

        scheduler = new ExpirationScheduler(
            processor as unknown as ExpirationProcessor,
            lease,
            30_000,
        );
    });

    afterEach(async () => {
        await scheduler.stop();
        vi.useRealTimers();
    });

    it('should start the scheduler', () => {
        scheduler.start();

        expect(processor.processExpiredTransactions).not.toHaveBeenCalled();
    });

    it('should not start more than once', async () => {
        scheduler.start();
        scheduler.start();

        await vi.advanceTimersByTimeAsync(30_000);

        expect(processor.processExpiredTransactions).toHaveBeenCalledTimes(1);
    });

    it('should skip execution when another worker owns the lease', async () => {
        lease.acquire.mockResolvedValueOnce(false);

        scheduler.start();

        await vi.advanceTimersByTimeAsync(30_000);

        expect(processor.processExpiredTransactions).not.toHaveBeenCalled();
        expect(lease.release).not.toHaveBeenCalled();
    });

    it('should invoke the expiration processor with the correct cutoff', async () => {
        const now = new Date('2026-08-12T16:00:00.000Z');

        vi.setSystemTime(now);

        scheduler.start();

        await vi.advanceTimersByTimeAsync(30_000);

        expect(processor.processExpiredTransactions).toHaveBeenCalledTimes(1);

        const [expirationBefore] = processor.processExpiredTransactions.mock.calls[0];

        const expectedNow = new Date(now.getTime() + 30_000);

        expect(expirationBefore).toEqual(new Date(expectedNow.getTime() - CONFIRMATION_TIMEOUT_MS));
    });

    it('should prevent overlapping executions', async () => {
        let resolveProcessing!: () => void;

        processor.processExpiredTransactions.mockReturnValueOnce(
            new Promise<number>((resolve) => {
                resolveProcessing = () => resolve(1);
            }),
        );

        scheduler.start();

        // First execution starts.
        await vi.advanceTimersByTimeAsync(30_000);

        expect(processor.processExpiredTransactions).toHaveBeenCalledTimes(1);

        // Next interval occurs while the first execution is still running.
        await vi.advanceTimersByTimeAsync(30_000);

        expect(processor.processExpiredTransactions).toHaveBeenCalledTimes(1);

        resolveProcessing();

        await vi.runOnlyPendingTimersAsync();
    });

    it('should stop scheduling new executions', async () => {
        scheduler.start();

        await vi.advanceTimersByTimeAsync(30_000);

        expect(processor.processExpiredTransactions).toHaveBeenCalledTimes(1);

        await scheduler.stop();

        await vi.advanceTimersByTimeAsync(60_000);

        expect(processor.processExpiredTransactions).toHaveBeenCalledTimes(1);
    });

    it('should be safe to stop before starting', async () => {
        await expect(scheduler.stop()).resolves.toBeUndefined();

        await vi.advanceTimersByTimeAsync(60_000);

        expect(processor.processExpiredTransactions).not.toHaveBeenCalled();
    });

    it('should recover after processor failure', async () => {
        processor.processExpiredTransactions
            .mockRejectedValueOnce(new Error('expiration processing failed'))
            .mockResolvedValueOnce(3);

        scheduler.start();

        // First run fails.
        await vi.advanceTimersByTimeAsync(30_000);

        expect(processor.processExpiredTransactions).toHaveBeenCalledTimes(1);

        // The scheduler should remain alive and permit the next run.
        await vi.advanceTimersByTimeAsync(30_000);

        expect(processor.processExpiredTransactions).toHaveBeenCalledTimes(2);
    });

    it('records worker_cycles_total for every attempt and worker_failures_total only for the failed one', async () => {
        processor.processExpiredTransactions
            .mockRejectedValueOnce(new Error('expiration processing failed'))
            .mockResolvedValueOnce(3);

        scheduler.start();

        await vi.advanceTimersByTimeAsync(30_000);
        await vi.advanceTimersByTimeAsync(30_000);

        const metrics = await registry.metrics();

        expect(metrics).toContain('worker_cycles_total{worker_name="expiration-scheduler"} 2');
        expect(metrics).toContain('worker_failures_total{worker_name="expiration-scheduler"} 1');
        expect(metrics).toContain(
            'worker_duration_seconds_count{worker_name="expiration-scheduler"} 2',
        );
    });

    it('does not record a cycle when the lease was not acquired', async () => {
        lease.acquire.mockResolvedValueOnce(false);

        scheduler.start();

        await vi.advanceTimersByTimeAsync(30_000);

        const metrics = await registry.metrics();

        expect(metrics).not.toContain('worker_cycles_total{worker_name="expiration-scheduler"}');
    });

    it('should allow restarting after stop', async () => {
        scheduler.start();

        await vi.advanceTimersByTimeAsync(30_000);

        expect(processor.processExpiredTransactions).toHaveBeenCalledTimes(1);

        await scheduler.stop();

        scheduler.start();

        await vi.advanceTimersByTimeAsync(30_000);

        expect(processor.processExpiredTransactions).toHaveBeenCalledTimes(2);
    });
});
