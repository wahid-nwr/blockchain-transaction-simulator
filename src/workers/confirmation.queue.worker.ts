import { Worker } from 'bullmq';

import { redisConnection } from '../queues/redis.connection.js';
import { QUEUES } from '../queues/queue.constants.js';
import { WORKER_NAMES } from '../queues/worker.constants.js';

import { ConfirmationProcessor } from './confirmation.processor.js';
import { TransactionRepository } from '../repositories/transaction.repository.js';

import { getLogger } from '../observability/logger.js';
import { workerReady } from '../observability/worker.metrics.js';
import { env } from '../config/env.js';

const WORKER_NAME = WORKER_NAMES.CONFIRMATION;

export interface ConfirmationJobPayload {
    transactionId: string;
    tenantId: string;
}

const processor = new ConfirmationProcessor(new TransactionRepository());

export const confirmationQueueWorker = new Worker<ConfirmationJobPayload>(
    QUEUES.TRANSACTION_CONFIRMATION,

    async (job) => {
        getLogger().info(
            {
                worker: WORKER_NAME,
                jobId: job.id,
                transactionId: job.data.transactionId,
                tenantId: job.data.tenantId,
            },
            'confirmation.job.started',
        );

        await processor.processTransaction(job.data.transactionId, job.data.tenantId);
    },

    {
        connection: redisConnection,

        concurrency: 5,

        lockDuration: env.CONFIRMATION_LOCK_DURATION_MS,
        stalledInterval: env.CONFIRMATION_STALLED_INTERVAL_MS,
        maxStalledCount: env.CONFIRMATION_MAX_STALLED_COUNT,

        autorun: true,
    },
);

confirmationQueueWorker.on('ready', () => {
    getLogger().info(
        {
            worker: WORKER_NAME,
        },
        'worker.ready',
    );
});

confirmationQueueWorker.on('completed', (job) => {
    getLogger().info(
        {
            worker: WORKER_NAME,

            jobId: job.id,

            transactionId: job.data.transactionId,
        },

        'confirmation.job.completed',
    );
});

confirmationQueueWorker.on('failed', (job, error) => {
    getLogger().error(
        {
            worker: WORKER_NAME,

            jobId: job?.id,

            transactionId: job?.data.transactionId,

            tenantId: job?.data.tenantId,

            error: error.message,
        },

        'confirmation.job.failed',
    );
});

confirmationQueueWorker.on('error', (error) => {
    workerReady.set(
        {
            worker_name: WORKER_NAME,
        },
        0,
    );

    getLogger().error(
        {
            worker: WORKER_NAME,

            error: error.message,
        },

        'confirmation.worker.error',
    );
});
