import { Worker } from 'bullmq';

import { redisConnection } from '../queues/redis.connection.js';
import { QUEUES } from '../queues/queue.constants.js';

import { ConfirmationProcessor } from './confirmation.processor.js';
import { TransactionRepository } from '../repositories/transaction.repository.js';

const processor = new ConfirmationProcessor(new TransactionRepository());

export const confirmationQueueWorker = new Worker(
    QUEUES.TRANSACTION_CONFIRMATION,

    async (job) => {
        await processor.processTransaction(job.data.transactionId, job.data.tenantId);
    },

    {
        connection: redisConnection,

        concurrency: 5,
    },
);
