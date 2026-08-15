import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { Queue, QueueEvents, Worker } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { redisConnection } from '../../src/queues/redis.connection.js';

describe('BullMQ worker crash/stall resilience', () => {
    const queueName = `bullmq-resilience-${randomUUID()}`;

    let queue: Queue<{ value: string }>;
    let queueEvents: QueueEvents;
    let workerB: Worker<{ value: string }, string>;
    let workerA: ChildProcess | undefined;

    beforeEach(async () => {
        queue = new Queue<{ value: string }>(queueName, {
            connection: redisConnection,
        });

        queueEvents = new QueueEvents(queueName, {
            connection: redisConnection,
        });

        await queueEvents.waitUntilReady();
    });

    afterEach(async () => {
        if (workerA && !workerA.killed) {
            workerA.kill('SIGKILL');
        }

        workerA = undefined;

        await workerB?.close();
        await queueEvents?.close();
        await queue?.obliterate({ force: true });
        await queue?.close();
    });

    it('recovers a job after the worker process crashes and its lock expires', async () => {
        const helperPath = fileURLToPath(
            new URL('./fixtures/bullmq.crash.worker.ts', import.meta.url),
        );

        /*
         * Start Worker A BEFORE adding the job.
         *
         * This guarantees Worker A is the worker that receives
         * the job and subsequently crashes.
         */
        workerA = spawn(process.execPath, ['--import', 'tsx', helperPath, queueName], {
            env: process.env,
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        let workerAOutput = '';

        workerA.stdout?.on('data', (chunk: Buffer) => {
            workerAOutput += chunk.toString();
        });

        workerA.stderr?.on('data', (chunk: Buffer) => {
            workerAOutput += `STDERR: ${chunk.toString()}`;
        });

        const workerAReady = new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => {
                reject(
                    new Error(`Timed out waiting for Worker A to become ready.\n${workerAOutput}`),
                );
            }, 10_000);

            const check = () => {
                if (workerAOutput.includes('READY')) {
                    clearTimeout(timer);
                    resolve();
                    return;
                }

                setTimeout(check, 25);
            };

            check();

            workerA?.once('error', (error) => {
                clearTimeout(timer);
                reject(error);
            });

            workerA?.once('exit', (code, signal) => {
                if (!workerAOutput.includes('READY')) {
                    clearTimeout(timer);

                    reject(
                        new Error(
                            `Worker A exited before becoming ready. ` +
                                `code=${code}, signal=${signal}\n${workerAOutput}`,
                        ),
                    );
                }
            });
        });

        await workerAReady;

        let processedByWorkerB = false;

        workerB = new Worker<{ value: string }, string>(
            queueName,
            async (job) => {
                processedByWorkerB = true;

                return `worker-b:${job.data.value}`;
            },
            {
                connection: redisConnection,
                concurrency: 1,
                lockDuration: 1_000,
                stalledInterval: 500,
                maxStalledCount: 1,
            },
        );

        await workerB.waitUntilReady();

        const job = await queue.add('resilience-test', {
            value: 'test',
        });

        const stalled = new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => {
                reject(new Error('Timed out waiting for BullMQ stalled event'));
            }, 10_000);

            queueEvents.on('stalled', ({ jobId }) => {
                if (jobId !== job.id) {
                    return;
                }

                clearTimeout(timer);
                resolve();
            });
        });

        const completed = new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => {
                reject(new Error('Timed out waiting for BullMQ completed event'));
            }, 10_000);

            queueEvents.on('completed', ({ jobId }) => {
                if (jobId !== job.id) {
                    return;
                }

                clearTimeout(timer);
                resolve();
            });
        });

        /*
         * Worker A should now have the job and crash.
         */
        const workerAActive = new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => {
                reject(
                    new Error(`Timed out waiting for Worker A to become active.\n${workerAOutput}`),
                );
            }, 10_000);

            const check = () => {
                if (workerAOutput.includes('ACTIVE')) {
                    clearTimeout(timer);
                    resolve();
                    return;
                }

                setTimeout(check, 25);
            };

            check();
        });

        await workerAActive;

        /*
         * Worker A now crashes.
         *
         * BullMQ should eventually detect that its lock has expired,
         * emit "stalled", and make the job available to Worker B.
         */
        await stalled;

        /*
         * Wait until Worker B has actually processed the recovered job.
         */
        await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => {
                reject(new Error('Timed out waiting for Worker B to process recovered job'));
            }, 10_000);

            const check = () => {
                if (processedByWorkerB) {
                    clearTimeout(timer);
                    resolve();
                    return;
                }

                setTimeout(check, 25);
            };

            check();
        });

        await completed;

        expect(processedByWorkerB).toBe(true);
        expect(await job.getState()).toBe('completed');
    });
});
