import { randomUUID } from 'node:crypto';

import { publicClient } from '../blockchain/client.js';
import { executeRpc } from '../blockchain/rpc.executor.js';
import { TransactionRepository } from '../repositories/transaction.repository.js';
import { incrementMetric, observeMetric } from '../observability/metrics.js';
import {
    transactionsConfirmedTotal,
    transactionsFailedTotal,
    transactionsRevertedTotal,
    transactionConfirmationDurationSeconds,
} from '../observability/transaction.metrics.js';
import {
    workerCyclesTotal,
    workerDurationSeconds,
    workerFailuresTotal,
    workerReady,
    confirmationWorkerPendingTransactions,
} from '../observability/worker.metrics.js';
import { getLogger } from '../observability/logger.js';
import { runWithContext, updateContext } from '../observability/context.js';

export class ConfirmationWorker {
    private static readonly WORKER_NAME = 'confirmation-worker';

    private running = false;

    private stopping = false;

    constructor(
        private readonly repo: TransactionRepository,
        private readonly intervalMs = Number(process.env.CONFIRMATION_INTERVAL_MS ?? 5000),
    ) {}

    async start() {
        if (this.running) {
            throw new Error('Confirmation worker already running');
        }

        this.running = true;
        this.stopping = false;

        workerReady.set(
            {
                worker_name: 'confirmation-worker',
            },
            1,
        );

        getLogger().info(
            {
                intervalMs: this.intervalMs,
            },
            'worker.started',
        );

        while (this.running) {
            try {
                await runWithContext(
                    {
                        correlationId: randomUUID(),
                        cycleId: randomUUID(),
                        worker: ConfirmationWorker.WORKER_NAME,
                    },
                    async () => {
                        await this.processCycle();
                    },
                );
            } catch (error) {
                incrementMetric(workerFailuresTotal, {
                    worker_name: ConfirmationWorker.WORKER_NAME,
                });

                getLogger().error(
                    {
                        error: error instanceof Error ? error.message : String(error),
                    },
                    'worker.cycle.failed',
                );
            }

            if (this.running) {
                await this.delay(this.intervalMs);
            }
        }

        getLogger().info({}, 'worker.stopped');
    }

    async stop() {
        if (!this.running || this.stopping) {
            return;
        }

        workerReady.set(
            {
                worker_name: ConfirmationWorker.WORKER_NAME,
            },
            0,
        );
        confirmationWorkerPendingTransactions.set(0);

        this.stopping = true;

        getLogger().info(
            {
                worker: ConfirmationWorker.WORKER_NAME,
            },
            'worker.stopping',
        );

        this.running = false;
    }

    isRunning() {
        return this.running;
    }

    async process() {
        return this.processCycle();
    }

    async processCycle() {
        const startedAt = process.hrtime.bigint();

        getLogger().debug(
            {
                worker: ConfirmationWorker.WORKER_NAME,
            },
            'worker.cycle.started',
        );

        incrementMetric(workerCyclesTotal, {
            worker_name: ConfirmationWorker.WORKER_NAME,
        });

        const pending = await this.repo.findPending();

        confirmationWorkerPendingTransactions.set(pending.length);

        for (const tx of pending) {
            if (!tx.txHash) {
                continue;
            }

            try {
                const confirmationStartedAt = process.hrtime.bigint();

                updateContext({
                    transactionId: tx.id,
                    txHash: tx.txHash,
                    tenantId: tx.tenantId,
                    tokenId: tx.tokenId,
                });

                getLogger().info(
                    {
                        worker: ConfirmationWorker.WORKER_NAME,
                    },
                    'transaction.confirmation.started',
                );

                const receipt = await executeRpc('getTransactionReceipt', () =>
                    publicClient.getTransactionReceipt({
                        hash: tx.txHash as `0x${string}`,
                    }),
                );

                if (receipt.status === 'success') {
                    await this.repo.confirm(tx.txHash, {
                        blockNumber: Number(receipt.blockNumber),
                        gasUsed: receipt.gasUsed,
                    });

                    const durationSeconds =
                        Number(process.hrtime.bigint() - confirmationStartedAt) / 1_000_000_000;

                    incrementMetric(transactionsConfirmedTotal, {
                        tenantId: tx.tenantId,
                        tokenId: tx.tokenId,
                    });

                    observeMetric(transactionConfirmationDurationSeconds, durationSeconds, {
                        tenantId: tx.tenantId,
                        tokenId: tx.tokenId,
                    });

                    getLogger().info(
                        {
                            blockNumber: Number(receipt.blockNumber),
                            status: 'CONFIRMED',
                            durationMs: durationSeconds * 1000,
                        },
                        'transaction.confirmed',
                    );
                } else {
                    await this.repo.updateStatus(tx.txHash, 'FAILED');

                    incrementMetric(transactionsRevertedTotal, {
                        tenantId: tx.tenantId,
                        tokenId: tx.tokenId,
                    });

                    getLogger().warn(
                        {
                            status: 'FAILED',
                        },
                        'transaction.reverted',
                    );
                }
            } catch (error) {
                if (error instanceof Error && error.message.includes('could not be found')) {
                    continue;
                }

                incrementMetric(transactionsFailedTotal, {
                    tenantId: tx.tenantId,
                    tokenId: tx.tokenId,
                    status: 'CONFIRMATION_ERROR',
                });

                incrementMetric(workerFailuresTotal, {
                    worker_name: ConfirmationWorker.WORKER_NAME,
                });

                getLogger().error(
                    {
                        error: error instanceof Error ? error.message : String(error),
                    },
                    'transaction.confirmation.failed',
                );
            } finally {
                updateContext({
                    transactionId: undefined,
                    tenantId: undefined,
                    tokenId: undefined,
                    txHash: undefined,
                });
            }
        }

        const durationSeconds = Number(process.hrtime.bigint() - startedAt) / 1_000_000_000;

        observeMetric(workerDurationSeconds, durationSeconds, {
            worker_name: ConfirmationWorker.WORKER_NAME,
        });

        getLogger().info(
            {
                durationMs: Number(process.hrtime.bigint() - startedAt) / 1_000_000,
            },
            'worker.cycle.completed',
        );
    }

    private delay(ms: number) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}
