import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const schedulerStart = vi.fn();
const schedulerStop = vi.fn().mockResolvedValue(undefined);
const queueClose = vi.fn().mockResolvedValue(undefined);
const metricsStart = vi.fn().mockReturnValue('metrics-server');
const metricsStop = vi.fn().mockResolvedValue(undefined);
const workerReadySet = vi.fn();
const processExit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

vi.mock('../../src/workers/expiration.scheduler.js', () => ({
    ExpirationScheduler: vi.fn().mockImplementation(() => ({
        start: schedulerStart,
        stop: schedulerStop,
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
    });

    afterEach(() => {
        process.removeAllListeners('SIGTERM');
        process.removeAllListeners('SIGINT');
    });

    it('starts the expiration scheduler', async () => {
        const { startConfirmationQueueWorker } =
            await import('../../src/workers/confirmation.queue.runner.js');

        await startConfirmationQueueWorker();

        expect(schedulerStart).toHaveBeenCalledTimes(1);
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

        expect(schedulerStop).toHaveBeenCalledTimes(1);
        expect(queueClose).toHaveBeenCalledTimes(1);
        expect(metricsStop).toHaveBeenCalledTimes(1);
        expect(metricsStop).toHaveBeenCalledWith('metrics-server');
    });
});
