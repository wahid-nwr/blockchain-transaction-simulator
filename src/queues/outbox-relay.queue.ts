import { Queue } from 'bullmq';
import { redisConnection } from './redis.connection.js';
import { QUEUES } from './queue.constants.js';

export interface OutboxRelayJob {
    /** OutboxEvent.id — used by the processor to mark the row as published */
    outboxEventId: string;
    aggregateId: string;
    type: string;
    payload: unknown;
}

export const outboxRelayQueue = new Queue<OutboxRelayJob>(QUEUES.OUTBOX_RELAY, {
    connection: redisConnection,
    defaultJobOptions: {
        attempts: 5,
        backoff: { type: 'exponential', delay: 2_000 },
        removeOnComplete: true,
        removeOnFail: false,
    },
});
