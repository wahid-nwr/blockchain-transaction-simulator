import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const expirationSchedulerStart = vi.fn();
const expirationSchedulerStop = vi.fn().mockResolvedValue(undefined);

const submissionRecoverySchedulerStart = vi.fn();
const submissionRecoverySchedulerStop = vi.fn().mockResolvedValue(undefined);

const pendingTransactionsSamplerStart = vi.fn();
const pendingTransactionsSamplerStop = vi.fn();

const pendingRecoverySchedulerStart = vi.fn();
const pendingRecoverySchedulerStop = vi.fn().mockResolvedValue(undefined);

const queueWaitUntilReady = vi.fn().mockResolvedValue(undefined);
const queueClose = vi.fn().mockResolvedValue(undefined);
const redisQuit = vi.fn().mockResolvedValue('OK');

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

vi.mock('../../src/workers/pending-transactions-sampler.js', () => ({
    PendingTransactionsSampler: vi.fn().mockImplementation(() => ({
        start: pendingTransactionsSamplerStart,
        stop: pendingTransactionsSamplerStop,
    })),
}));

vi.mock('../../src/workers/pending-recovery.scheduler.js', () => ({
    PendingRecoveryScheduler: vi.fn().mockImplementation(() => ({
        start: pendingRecoverySchedulerStart,
        stop: pendingRecoverySchedulerStop,
    })),
}));

vi.mock('../../src/workers/pending-recovery.processor.js', () => ({
    PendingRecoveryProcessor: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('../../src/repositories/transfer.repository.js', () => ({
    TransferRepository: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('../../src/repositories/token-event-cursor.repository.js', () => ({
    TokenEventCursorRepository: vi.fn().mockImplementation(() => ({})),
}));

// TransactionRepository itself has no I/O in its constructor, but importing
// it pulls in src/database/prisma.ts, which constructs a real PrismaClient
// at module load time. Mocked here so this lifecycle test doesn't require
// a generated Prisma client / live DB just to run — consistent with every
// other dependency in this file being isolated at the module boundary.
vi.mock('../../src/repositories/transaction.repository.js', () => ({
    TransactionRepository: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('../../src/workers/confirmation.queue.worker.js', () => ({
    confirmationQueueWorker: {
        waitUntilReady: queueWaitUntilReady,
        setWorkerReady: vi.fn().mockResolvedValue(undefined),
        close: queueClose,
    },
}));

vi.mock('../../src/workers/worker-metrics.server.js', () => ({
    startWorkerMetricsServer: metricsStart,
    stopWorkerMetricsServer: metricsStop,
    setWorkerReady: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/queues/redis.connection.js', () => ({
    redisConnection: {
        status: 'ready',
        quit: redisQuit,
    },
}));

vi.mock('../../src/observability/worker.metrics.js', () => ({
    workerReady: {
        set: workerReadySet,
    },
}));

vi.mock('../../src/observability/logger.js', () => ({
    getLogger: vi.fn(() => ({
        info: vi.fn(),
        warn: vi.fn(),
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

        pendingTransactionsSamplerStart.mockReset();
        pendingTransactionsSamplerStop.mockReset();

        pendingRecoverySchedulerStart.mockReset();
        pendingRecoverySchedulerStop.mockReset();

        queueWaitUntilReady.mockReset();
        queueClose.mockReset();
        redisQuit.mockReset();
        metricsStart.mockReset();
        metricsStop.mockReset();
        workerReadySet.mockReset();

        expirationSchedulerStop.mockResolvedValue(undefined);
        submissionRecoverySchedulerStop.mockResolvedValue(undefined);
        queueWaitUntilReady.mockResolvedValue(undefined);
        queueClose.mockResolvedValue(undefined);
        redisQuit.mockResolvedValue('OK');
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

        expect(queueWaitUntilReady).toHaveBeenCalledTimes(1);
        expect(submissionRecoverySchedulerStart).toHaveBeenCalledTimes(1);
        expect(expirationSchedulerStart).toHaveBeenCalledTimes(1);
        expect(pendingTransactionsSamplerStart).toHaveBeenCalledTimes(1);
        expect(pendingRecoverySchedulerStart).toHaveBeenCalledTimes(1);
        expect(workerReadySet).toHaveBeenLastCalledWith(
            { worker_name: 'confirmation-queue-worker' },
            1,
        );
    });

    it('does not start schedulers or report readiness until the queue worker is ready', async () => {
        let resolveReady!: () => void;

        queueWaitUntilReady.mockImplementation(
            () =>
                new Promise<void>((resolve) => {
                    resolveReady = resolve;
                }),
        );

        const { startConfirmationQueueWorker } =
            await import('../../src/workers/confirmation.queue.runner.js');

        const startPromise = startConfirmationQueueWorker();

        await vi.waitFor(() => {
            expect(queueWaitUntilReady).toHaveBeenCalledTimes(1);
        });

        expect(expirationSchedulerStart).not.toHaveBeenCalled();
        expect(submissionRecoverySchedulerStart).not.toHaveBeenCalled();
        expect(pendingTransactionsSamplerStart).not.toHaveBeenCalled();
        expect(pendingRecoverySchedulerStart).not.toHaveBeenCalled();
        expect(workerReadySet).toHaveBeenLastCalledWith(
            { worker_name: 'confirmation-queue-worker' },
            0,
        );

        resolveReady();
        await startPromise;

        expect(expirationSchedulerStart).toHaveBeenCalledTimes(1);
        expect(submissionRecoverySchedulerStart).toHaveBeenCalledTimes(1);
        expect(pendingTransactionsSamplerStart).toHaveBeenCalledTimes(1);
        expect(pendingRecoverySchedulerStart).toHaveBeenCalledTimes(1);
        expect(workerReadySet).toHaveBeenLastCalledWith(
            { worker_name: 'confirmation-queue-worker' },
            1,
        );
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
        expect(pendingTransactionsSamplerStop).toHaveBeenCalledTimes(1);
        expect(pendingRecoverySchedulerStop).toHaveBeenCalledTimes(1);
        expect(queueClose).toHaveBeenCalledTimes(1);
        expect(redisQuit).toHaveBeenCalledTimes(1);
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

        const redisQuitCalls = redisQuit.mock.calls.length;

        const metricsStopCalls = metricsStop.mock.calls.length;

        sigintListeners[0]('SIGINT');

        expect(submissionRecoverySchedulerStop).toHaveBeenCalledTimes(submissionStopCalls);

        expect(expirationSchedulerStop).toHaveBeenCalledTimes(expirationStopCalls);

        expect(queueClose).toHaveBeenCalledTimes(queueCloseCalls);

        expect(redisQuit).toHaveBeenCalledTimes(redisQuitCalls);

        expect(metricsStop).toHaveBeenCalledTimes(metricsStopCalls);

        releaseSchedulerStop();

        await vi.waitFor(() => {
            expect(processExit).toHaveBeenCalledWith(0);
        });

        expect(submissionRecoverySchedulerStop).toHaveBeenCalledTimes(1);
        expect(expirationSchedulerStop).toHaveBeenCalledTimes(1);
        expect(queueClose).toHaveBeenCalledTimes(1);
        expect(redisQuit).toHaveBeenCalledTimes(1);
        expect(metricsStop).toHaveBeenCalledTimes(1);
    });
});
