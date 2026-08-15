import { Worker } from 'bullmq';
import { redisConnection } from '../../../src/queues/redis.connection.js';

const queueName = process.argv[2];

if (!queueName) {
    throw new Error('Queue name argument is required');
}

const worker = new Worker(
    queueName,
    async () => {
        process.stdout.write('ACTIVE\n');

        setTimeout(() => {
            process.exit(1);
        }, 100);

        // Keep the job active until the worker crashes.
        await new Promise(() => {});
    },
    {
        connection: redisConnection,
        concurrency: 1,
        lockDuration: 1_000,
        stalledInterval: 500,
        maxStalledCount: 1,
    },
);

worker.on('error', (error) => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
});

await worker.waitUntilReady();

process.stdout.write('READY\n');
