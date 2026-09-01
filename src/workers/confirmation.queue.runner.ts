// Must be the first import — see otel-preload.ts for why.
import '../observability/otel-preload.js';

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
import { PendingRecoveryProcessor } from './pending-recovery.processor.js';
import { PendingRecoveryScheduler } from './pending-recovery.scheduler.js';
import { PostgresSchedulerLease } from '../scheduling/postgres-scheduler-lease.js';

import { EventListenerWorker } from './event-listener.worker.js';
import { OutboxRelayScheduler } from './outbox-relay.scheduler.js';
import { outboxEventService } from '../services/outbox-event.service.js';
import { PendingTransactionsSampler } from './pending-transactions-sampler.js';
import { TransferRepository } from '../repositories/transfer.repository.js';
import { TokenEventCursorRepository } from '../repositories/token-event-cursor.repository.js';

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

function createPendingTransactionsSampler() {
    const repository = new TransactionRepository();

    return new PendingTransactionsSampler(
        repository,
        Number(process.env.PENDING_TRANSACTIONS_SAMPLE_INTERVAL_MS ?? 15_000),
    );
}

function createPendingRecoveryScheduler() {
    const processor = new PendingRecoveryProcessor(
        new TransactionRepository(),
        new TransferRepository(),
        new TokenEventCursorRepository(),
        // Minimum age before a PENDING transaction is even considered —
        // must comfortably exceed how long a normal request takes, so an
        // in-flight submission is never mistaken for orphaned. Default 2m
        // is generous relative to a normal submission (milliseconds to a
        // couple seconds).
        Number(process.env.PENDING_RECOVERY_GRACE_MS ?? 120_000),
        // Minimum age before "no matching on-chain transfer found" is
        // trusted enough to mark the transaction FAILED. Must clear grace
        // + normal chain-confirmation time + event-indexing time with
        // margin — see PendingRecoveryProcessor's own documentation for
        // why this is deliberately conservative.
        Number(process.env.PENDING_RECOVERY_FAIL_AFTER_MS ?? 900_000),
        // How stale the event listener's last successful sync can be
        // before a "no evidence" result is refused outright. Default 60s
        // is generous relative to EVENT_LISTENER_INTERVAL_MS's own 5s
        // default.
        Number(process.env.PENDING_RECOVERY_LISTENER_STALENESS_MS ?? 60_000),
    );

    return new PendingRecoveryScheduler(
        processor,
        new PostgresSchedulerLease(),
        Number(process.env.PENDING_RECOVERY_INTERVAL_MS ?? 30_000),
    );
}

export async function startConfirmationQueueWorker() {
    const metricsServer = startWorkerMetricsServer();

    const expirationScheduler = createExpirationScheduler();
    const submissionRecoveryScheduler = createSubmissionRecoveryScheduler();
    const outboxRelayScheduler = createOutboxRelayScheduler();
    const pendingTransactionsSampler = createPendingTransactionsSampler();
    const pendingRecoveryScheduler = createPendingRecoveryScheduler();
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
    pendingTransactionsSampler.start();
    pendingRecoveryScheduler.start();

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

            pendingTransactionsSampler.stop();

            await pendingRecoveryScheduler.stop();

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