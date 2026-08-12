import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { ExpirationScheduler } from '../../src/workers/expiration.scheduler.js';
import { ExpirationProcessor } from '../../src/workers/expiration.processor.js';
import { CONFIRMATION_TIMEOUT_MS } from '../../src/domain/transaction/transaction-expiration.js';

describe('ExpirationScheduler', () => {
    let processor: {
        processExpiredTransactions: ReturnType<typeof vi.fn>;
    };

    let scheduler: ExpirationScheduler;

    beforeEach(() => {
        vi.useFakeTimers();

        processor = {
            processExpiredTransactions: vi.fn().mockResolvedValue(0),
        };

        scheduler = new ExpirationScheduler(processor as unknown as ExpirationProcessor, 30_000);
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
