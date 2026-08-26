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

import { EventListenerWorker } from './event-listener.worker.js';
import { OutboxRelayScheduler } from './outbox-relay.scheduler.js';
import { outboxEventService } from '../services/outbox-event.service.js';

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

function createOutboxRelayScheduler() {
    return new OutboxRelayScheduler(outboxEventService, new PostgresSchedulerLease());
}

export async function startConfirmationQueueWorker() {
    const metricsServer = startWorkerMetricsServer();

    const expirationScheduler = createExpirationScheduler();
    const submissionRecoveryScheduler = createSubmissionRecoveryScheduler();
    const outboxRelayScheduler = createOutboxRelayScheduler();
    const eventListenerWorker = new EventListenerWorker();

    workerReady.set(
        {
            worker_name: WORKER_NAME,
        },
        0,
    );

    await confirmationQueueWorker.waitUntilReady();

    expirationScheduler.start();
    submissionRecoveryScheduler.start();
    outboxRelayScheduler.start();

    /*
     * EventListenerWorker.start() owns a long-running loop and therefore
     * must not be awaited here. Awaiting it would prevent the unified
     * worker from ever reaching its readiness state.
     */
    if (process.env.DISABLE_WORKERS !== 'true') {
        const intervalMs = Number(process.env.EVENT_LISTENER_INTERVAL_MS ?? 5000);

        void eventListenerWorker.start(intervalMs).catch((error) => {
            getLogger().error(
                {
                    worker: 'event-listener-worker',
                    error: error instanceof Error ? error.message : String(error),
                },
                'event.listener.worker.crashed',
            );

            process.exitCode = 1;
        });
    }

    workerReady.set(
        {
            worker_name: WORKER_NAME,
        },
        1,
    );

    setWorkerReady(true);

    getLogger().info(
        {
            worker: WORKER_NAME,
            eventListenerEnabled: process.env.DISABLE_WORKERS !== 'true',
            eventListenerIntervalMs: Number(process.env.EVENT_LISTENER_INTERVAL_MS ?? 5000),
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

            /*
             * Stop the event listener before shutting down the other
             * worker components.
             */
            await eventListenerWorker.stop();

            await expirationScheduler.stop();

            await submissionRecoveryScheduler.stop();

            await outboxRelayScheduler.stop();

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
