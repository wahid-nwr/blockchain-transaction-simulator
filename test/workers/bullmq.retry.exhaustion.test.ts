import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Queue, QueueEvents, Worker } from 'bullmq';
import { randomUUID } from 'node:crypto';

import { redisConnection } from '../../src/queues/redis.connection.js';

describe('BullMQ retry exhaustion resilience', () => {
    const queueName = `bullmq-retry-exhaustion-${randomUUID()}`;

    let queue: Queue<{ value: string }>;
    let queueEvents: QueueEvents;
    let worker: Worker<{ value: string }>;

    beforeEach(async () => {
        queue = new Queue<{ value: string }>(queueName, {
            connection: redisConnection,
            defaultJobOptions: {
                attempts: 3,

                backoff: {
                    type: 'exponential',
                    delay: 50,
                },

                removeOnComplete: true,
                removeOnFail: false,
            },
        });

        queueEvents = new QueueEvents(queueName, {
            connection: redisConnection,
        });

        await queueEvents.waitUntilReady();
    });

    afterEach(async () => {
        await worker?.close();
        await queueEvents?.close();
        await queue?.obliterate({ force: true });
        await queue?.close();
    });

    it('moves a repeatedly failing job to failed after retry exhaustion', async () => {
        let attempts = 0;

        worker = new Worker<{ value: string }>(
            queueName,
            async () => {
                attempts++;

                throw new Error('intentional retry exhaustion failure');
            },
            {
                connection: redisConnection,
                concurrency: 1,
            },
        );

        await worker.waitUntilReady();

        const job = await queue.add('retry-exhaustion-test', {
            value: 'test',
        });

        const failed = new Promise<{
            jobId: string;
            failedReason: string;
        }>((resolve, reject) => {
            const timer = setTimeout(() => {
                reject(new Error('Timed out waiting for BullMQ failed event'));
            }, 10_000);

            queueEvents.on('failed', ({ jobId, failedReason }) => {
                if (jobId !== job.id) {
                    return;
                }

                clearTimeout(timer);

                resolve({
                    jobId,
                    failedReason,
                });
            });
        });

        const result = await failed;

        expect(result.jobId).toBe(job.id);
        expect(result.failedReason).toBe('intentional retry exhaustion failure');

        /*
         * attemptsMade is zero-based internally when represented on
         * certain BullMQ objects, so assert the actual processing count
         * separately.
         */
        expect(attempts).toBe(3);

        expect(await job.getState()).toBe('failed');

        /*
         * removeOnFail=false means the failed job remains available
         * for inspection/recovery.
         */
        const failedJob = await queue.getJob(job.id!);

        expect(failedJob).toBeDefined();
        expect(failedJob?.failedReason).toBe('intentional retry exhaustion failure');
    });
});
