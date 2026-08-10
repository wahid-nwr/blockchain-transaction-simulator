import { Queue } from 'bullmq';

import { redisConnection } from './redis.connection.js';
import { QUEUES } from './queue.constants.js';

export interface BlockchainEventJob {
    blockNumber: number;
}

export const blockchainEventQueue = new Queue<BlockchainEventJob>(QUEUES.BLOCKCHAIN_EVENTS, {
    connection: redisConnection,
});
