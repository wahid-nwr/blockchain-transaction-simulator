import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SubmissionRecoveryProcessor } from '../../src/workers/submission-recovery.processor.js';
import { SubmissionRecoveryScheduler } from '../../src/workers/submission-recovery.scheduler.js';

describe('SubmissionRecoveryScheduler', () => {
    const processorMock = {
        processSubmittedTransactions: vi.fn(),
    };

    let scheduler: SubmissionRecoveryScheduler;

    beforeEach(() => {
        vi.useFakeTimers();
        vi.clearAllMocks();

        processorMock.processSubmittedTransactions.mockResolvedValue(undefined);

        scheduler = new SubmissionRecoveryScheduler(
            processorMock as unknown as SubmissionRecoveryProcessor,
            1000,
        );
    });

    afterEach(async () => {
        await scheduler.stop();
        vi.useRealTimers();
    });

    it('should start the scheduler', async () => {
        scheduler.start();

        await vi.advanceTimersByTimeAsync(1000);

        expect(processorMock.processSubmittedTransactions).toHaveBeenCalledTimes(1);
    });

    it('should not start the scheduler more than once', async () => {
        scheduler.start();
        scheduler.start();

        await vi.advanceTimersByTimeAsync(1000);

        expect(processorMock.processSubmittedTransactions).toHaveBeenCalledTimes(1);
    });

    it('should execute recovery on each interval', async () => {
        scheduler.start();

        await vi.advanceTimersByTimeAsync(3000);

        expect(processorMock.processSubmittedTransactions).toHaveBeenCalledTimes(3);
    });

    it('should stop scheduled recovery', async () => {
        scheduler.start();

        await vi.advanceTimersByTimeAsync(1000);

        await scheduler.stop();

        await vi.advanceTimersByTimeAsync(3000);

        expect(processorMock.processSubmittedTransactions).toHaveBeenCalledTimes(1);
    });

    it('should not execute recovery after stop', async () => {
        scheduler.start();

        await scheduler.stop();

        await vi.advanceTimersByTimeAsync(3000);

        expect(processorMock.processSubmittedTransactions).not.toHaveBeenCalled();
    });

    it('should prevent overlapping recovery executions', async () => {
        let resolveRecovery!: () => void;

        processorMock.processSubmittedTransactions.mockImplementationOnce(
            () =>
                new Promise<void>((resolve) => {
                    resolveRecovery = resolve;
                }),
        );

        scheduler.start();

        // First execution starts and remains in progress.
        await vi.advanceTimersByTimeAsync(1000);

        expect(processorMock.processSubmittedTransactions).toHaveBeenCalledTimes(1);

        // The next intervals must not start another execution.
        await vi.advanceTimersByTimeAsync(3000);

        expect(processorMock.processSubmittedTransactions).toHaveBeenCalledTimes(1);

        // Allow the first execution to complete.
        resolveRecovery();

        await vi.waitFor(() => {
            expect(processorMock.processSubmittedTransactions).toHaveBeenCalledTimes(1);
        });

        // The next interval can execute again.
        await vi.advanceTimersByTimeAsync(1000);

        expect(processorMock.processSubmittedTransactions).toHaveBeenCalledTimes(2);
    });

    it('should continue scheduling when recovery processing fails', async () => {
        processorMock.processSubmittedTransactions
            .mockRejectedValueOnce(new Error('Redis unavailable'))
            .mockResolvedValueOnce(undefined);

        scheduler.start();

        await vi.advanceTimersByTimeAsync(1000);

        expect(processorMock.processSubmittedTransactions).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(1000);

        expect(processorMock.processSubmittedTransactions).toHaveBeenCalledTimes(2);
    });
});
