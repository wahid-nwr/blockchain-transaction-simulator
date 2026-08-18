import { fileURLToPath } from 'node:url';

import { getLogger } from '../observability/logger.js';

import {
    startWorkerMetricsServer,
    stopWorkerMetricsServer,
    setWorkerReady,
} from './worker-metrics.server.js';

import { confirmationQueueWorker } from './confirmation.queue.worker.js';

import { workerReady } from '../observability/worker.metrics.js';
import { redisConnection } from '../queues/redis.connection.js';

import { TransactionRepository } from '../repositories/transaction.repository.js';
import { ExpirationProcessor } from './expiration.processor.js';
import { ExpirationScheduler } from './expiration.scheduler.js';
import { SubmissionRecoveryProcessor } from './submission-recovery.processor.js';
import { SubmissionRecoveryScheduler } from './submission-recovery.scheduler.js';
import { PostgresSchedulerLease } from '../scheduling/postgres-scheduler-lease.js';

const WORKER_NAME = 'confirmation-queue-worker';
let shuttingDown = false;

function createExpirationScheduler() {
    const repository = new TransactionRepository();
    const processor = new ExpirationProcessor(repository);

    return new ExpirationScheduler(processor, new PostgresSchedulerLease());
}

function createSubmissionRecoveryScheduler() {
    const repository = new TransactionRepository();
    const processor = new SubmissionRecoveryProcessor(repository);

    return new SubmissionRecoveryScheduler(processor, new PostgresSchedulerLease());
}

export async function startConfirmationQueueWorker() {
    const metricsServer = startWorkerMetricsServer();

    const expirationScheduler = createExpirationScheduler();
    const submissionRecoveryScheduler = createSubmissionRecoveryScheduler();

    workerReady.set(
        {
            worker_name: WORKER_NAME,
        },
        0,
    );

    await confirmationQueueWorker.waitUntilReady();

    expirationScheduler.start();
    submissionRecoveryScheduler.start();

    workerReady.set(
        {
            worker_name: WORKER_NAME,
        },
        1,
    );

    // Distinct from the Prometheus `workerReady` gauge above: this flips the
    // internal flag the /health HTTP endpoint reads (see
    // worker-metrics.server.ts). The two are easy to conflate by name but
    // serve different consumers — Prometheus scraping vs. Docker/orchestrator
    // healthchecks — and both need to be set for the worker to report ready
    // end-to-end.
    setWorkerReady(true);

    getLogger().info(
        {
            worker: WORKER_NAME,
        },
        'worker.started',
    );

    const shutdown = async (signal: string) => {
        if (shuttingDown) {
            return;
        }
        shuttingDown = true;

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

            setWorkerReady(false);

            await expirationScheduler.stop();
            await submissionRecoveryScheduler.stop();

            await confirmationQueueWorker.close();

            if (redisConnection.status !== 'end') {
                await redisConnection.quit();
            }

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
