import { Worker } from 'bullmq';

import { redisConnection } from '../queues/redis.connection.js';
import { QUEUES } from '../queues/queue.constants.js';

import { ConfirmationProcessor } from './confirmation.processor.js';
import { TransactionRepository } from '../repositories/transaction.repository.js';

import { getLogger } from '../observability/logger.js';

import { workerReady } from '../observability/worker.metrics.js';

const WORKER_NAME = 'confirmation-queue-worker';

const processor = new ConfirmationProcessor(new TransactionRepository());

export const confirmationQueueWorker = new Worker(
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

        autorun: true,
    },
);

confirmationQueueWorker.on('ready', () => {
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
