import { fileURLToPath } from 'node:url';

import { getLogger } from '../observability/logger.js';

import { startWorkerMetricsServer, stopWorkerMetricsServer } from './worker-metrics.server.js';

import { confirmationQueueWorker } from './confirmation.queue.worker.js';

import { workerReady } from '../observability/worker.metrics.js';

import { TransactionRepository } from '../repositories/transaction.repository.js';
import { ExpirationProcessor } from './expiration.processor.js';
import { ExpirationScheduler } from './expiration.scheduler.js';

const WORKER_NAME = 'confirmation-queue-worker';

function createExpirationScheduler() {
    const repository = new TransactionRepository();
    const processor = new ExpirationProcessor(repository);

    return new ExpirationScheduler(processor);
}

export async function startConfirmationQueueWorker() {
    const metricsServer = startWorkerMetricsServer();

    const expirationScheduler = createExpirationScheduler();

    expirationScheduler.start();

    workerReady.set(
        {
            worker_name: WORKER_NAME,
        },
        1,
    );

    getLogger().info(
        {
            worker: WORKER_NAME,
        },
        'worker.started',
    );

    const shutdown = async (signal: string) => {
        getLogger().info(
            {
                worker: WORKER_NAME,
                signal,
            },
            'worker.shutdown.requested',
        );

        try {
            workerReady.set(
                {
                    worker_name: WORKER_NAME,
                },
                0,
            );

            await expirationScheduler.stop();

            await confirmationQueueWorker.close();

            await stopWorkerMetricsServer(metricsServer);

            getLogger().info(
                {
                    worker: WORKER_NAME,
                    signal,
                },
                'worker.shutdown.completed',
            );

            process.exit(0);
        } catch (error) {
            getLogger().error(
                {
                    worker: WORKER_NAME,
                    signal,
                    error: error instanceof Error ? error.message : String(error),
                },
                'worker.shutdown.failed',
            );

            process.exit(1);
        }
    };

    process.once('SIGINT', () => void shutdown('SIGINT'));

    process.once('SIGTERM', () => void shutdown('SIGTERM'));
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
    startConfirmationQueueWorker().catch((error) => {
        getLogger().error(
            {
                worker: WORKER_NAME,
                error: error instanceof Error ? error.message : String(error),
            },
            'worker.crashed',
        );

        process.exit(1);
    });
}
