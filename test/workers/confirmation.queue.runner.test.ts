import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const expirationSchedulerStart = vi.fn();
const expirationSchedulerStop = vi.fn().mockResolvedValue(undefined);

const submissionRecoverySchedulerStart = vi.fn();
const submissionRecoverySchedulerStop = vi.fn().mockResolvedValue(undefined);

const queueClose = vi.fn().mockResolvedValue(undefined);

const metricsStart = vi.fn().mockReturnValue('metrics-server');
const metricsStop = vi.fn().mockResolvedValue(undefined);

const workerReadySet = vi.fn();

const processExit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

vi.mock('../../src/workers/expiration.scheduler.js', () => ({
    ExpirationScheduler: vi.fn().mockImplementation(() => ({
        start: expirationSchedulerStart,
        stop: expirationSchedulerStop,
    })),
}));

vi.mock('../../src/workers/submission-recovery.scheduler.js', () => ({
    SubmissionRecoveryScheduler: vi.fn().mockImplementation(() => ({
        start: submissionRecoverySchedulerStart,
        stop: submissionRecoverySchedulerStop,
    })),
}));

vi.mock('../../src/workers/confirmation.queue.worker.js', () => ({
    confirmationQueueWorker: {
        close: queueClose,
    },
}));

vi.mock('../../src/workers/worker-metrics.server.js', () => ({
    startWorkerMetricsServer: metricsStart,
    stopWorkerMetricsServer: metricsStop,
}));

vi.mock('../../src/observability/worker.metrics.js', () => ({
    workerReady: {
        set: workerReadySet,
    },
}));

vi.mock('../../src/observability/logger.js', () => ({
    getLogger: vi.fn(() => ({
        info: vi.fn(),
        error: vi.fn(),
    })),
}));

describe('ConfirmationQueueRunner', () => {
    beforeEach(() => {
        vi.clearAllMocks();

        expirationSchedulerStart.mockReset();
        expirationSchedulerStop.mockReset();

        submissionRecoverySchedulerStart.mockReset();
        submissionRecoverySchedulerStop.mockReset();

        queueClose.mockReset();
        metricsStart.mockReset();
        metricsStop.mockReset();
        workerReadySet.mockReset();

        expirationSchedulerStop.mockResolvedValue(undefined);
        submissionRecoverySchedulerStop.mockResolvedValue(undefined);
        queueClose.mockResolvedValue(undefined);
        metricsStart.mockReturnValue('metrics-server');
        metricsStop.mockResolvedValue(undefined);

        vi.resetModules();
    });

    afterEach(() => {
        process.removeAllListeners('SIGTERM');
        process.removeAllListeners('SIGINT');
    });

    it('starts the submission recovery and expiration schedulers', async () => {
        const { startConfirmationQueueWorker } =
            await import('../../src/workers/confirmation.queue.runner.js');

        await startConfirmationQueueWorker();

        expect(submissionRecoverySchedulerStart).toHaveBeenCalledTimes(1);
        expect(expirationSchedulerStart).toHaveBeenCalledTimes(1);
    });

    it('gracefully shuts down on SIGTERM', async () => {
        const { startConfirmationQueueWorker } =
            await import('../../src/workers/confirmation.queue.runner.js');

        await startConfirmationQueueWorker();

        const sigtermListeners = process.listeners('SIGTERM');

        expect(sigtermListeners).toHaveLength(1);

        sigtermListeners[0]('SIGTERM');

        await vi.waitFor(() => {
            expect(processExit).toHaveBeenCalledWith(0);
        });

        expect(workerReadySet).toHaveBeenLastCalledWith(
            {
                worker_name: 'confirmation-queue-worker',
            },
            0,
        );

        expect(submissionRecoverySchedulerStop).toHaveBeenCalledTimes(1);
        expect(expirationSchedulerStop).toHaveBeenCalledTimes(1);
        expect(queueClose).toHaveBeenCalledTimes(1);
        expect(metricsStop).toHaveBeenCalledTimes(1);

        expect(metricsStop).toHaveBeenCalledWith('metrics-server');
    });

    it('should ignore a second shutdown signal while shutdown is in progress', async () => {
        let releaseSchedulerStop!: () => void;

        const schedulerStopPromise = new Promise<void>((resolve) => {
            releaseSchedulerStop = resolve;
        });

        submissionRecoverySchedulerStop.mockReturnValue(schedulerStopPromise);
        expirationSchedulerStop.mockReturnValue(schedulerStopPromise);

        const { startConfirmationQueueWorker } =
            await import('../../src/workers/confirmation.queue.runner.js');

        await startConfirmationQueueWorker();

        const sigtermListeners = process.listeners('SIGTERM');
        const sigintListeners = process.listeners('SIGINT');

        expect(sigtermListeners).toHaveLength(1);
        expect(sigintListeners).toHaveLength(1);

        sigtermListeners[0]('SIGTERM');

        await vi.waitFor(() => {
            expect(
                submissionRecoverySchedulerStop.mock.calls.length +
                    expirationSchedulerStop.mock.calls.length,
            ).toBeGreaterThan(0);
        });

        const submissionStopCalls = submissionRecoverySchedulerStop.mock.calls.length;

        const expirationStopCalls = expirationSchedulerStop.mock.calls.length;

        const queueCloseCalls = queueClose.mock.calls.length;

        const metricsStopCalls = metricsStop.mock.calls.length;

        sigintListeners[0]('SIGINT');

        expect(submissionRecoverySchedulerStop).toHaveBeenCalledTimes(submissionStopCalls);

        expect(expirationSchedulerStop).toHaveBeenCalledTimes(expirationStopCalls);

        expect(queueClose).toHaveBeenCalledTimes(queueCloseCalls);

        expect(metricsStop).toHaveBeenCalledTimes(metricsStopCalls);

        releaseSchedulerStop();

        await vi.waitFor(() => {
            expect(processExit).toHaveBeenCalledWith(0);
        });

        expect(submissionRecoverySchedulerStop).toHaveBeenCalledTimes(1);
        expect(expirationSchedulerStop).toHaveBeenCalledTimes(1);
        expect(queueClose).toHaveBeenCalledTimes(1);
        expect(metricsStop).toHaveBeenCalledTimes(1);
    });
});
