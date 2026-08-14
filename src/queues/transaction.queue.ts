import { Queue } from 'bullmq';

import { redisConnection } from './redis.connection.js';
import { QUEUES } from './queue.constants.js';

export interface TransactionConfirmationJob {
    transactionId: string;
    tenantId: string;
}

export const transactionConfirmationQueue = new Queue<TransactionConfirmationJob>(
    QUEUES.TRANSACTION_CONFIRMATION,
    {
        connection: redisConnection,
        defaultJobOptions: {
            attempts: 5,

            backoff: {
                type: 'exponential',
                delay: 5000,
            },

            removeOnComplete: true,
            removeOnFail: false,
        },
    },
);
