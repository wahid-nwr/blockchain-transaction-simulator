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

import { getLogger } from '../observability/logger.js';
import { updateContext } from '../observability/context.js';

import { Transaction } from '@prisma/client';
import { TransactionStateConflictError } from '../common/errors/transaction-state-conflict.error.js';

export class ConfirmationProcessor {
    private static readonly NAME = 'confirmation-processor';

    constructor(private readonly repo: TransactionRepository) {}

    async processTransaction(transactionId: string, tenantId: string) {
        const transaction = await this.repo.findById(transactionId, tenantId);

        if (!transaction) {
            throw new Error(`Transaction ${transactionId} not found`);
        }

        if (!transaction.txHash) {
            getLogger().warn(
                {
                    transactionId,
                },
                'transaction.txHash.missing',
            );

            return;
        }

        await this.confirmTransaction(transaction);
    }

    private async confirmTransaction(tx: Transaction) {
        const startedAt = process.hrtime.bigint();

        updateContext({
            transactionId: tx.id,
            txHash: tx.txHash ?? undefined,
            tenantId: tx.tenantId,
            tokenId: tx.tokenId,
        });

        getLogger().info(
            {
                worker: ConfirmationProcessor.NAME,
            },
            'transaction.confirmation.started',
        );

        try {
            const receipt = await executeRpc('getTransactionReceipt', () =>
                publicClient.getTransactionReceipt({
                    hash: tx.txHash as `0x${string}`,
                }),
            );

            if (receipt.status === 'success') {
                try {
                    await this.repo.markConfirming(tx.id);
                } catch (error) {
                    if (!(error instanceof TransactionStateConflictError)) {
                        throw error;
                    }

                    /*
                     * Another confirmation worker may have already claimed
                     * the transaction.
                     *
                     * Re-read the authoritative database state.
                     */
                    const current = await this.repo.findById(tx.id, tx.tenantId);

                    if (!current) {
                        throw new Error(`Transaction ${tx.id} not found`);
                    }

                    /*
                     * Another worker already completed the transaction.
                     * This is a stale/duplicate confirmation job.
                     */
                    if (
                        current.status === 'CONFIRMED' ||
                        current.status === 'FAILED' ||
                        current.status === 'EXPIRED'
                    ) {
                        getLogger().info(
                            {
                                transactionId: tx.id,
                                status: current.status,
                            },
                            'transaction.confirmation.stale',
                        );

                        return;
                    }

                    /*
                     * Another worker claimed the transaction and it is
                     * already CONFIRMING. We can safely continue.
                     */
                    if (current.status !== 'CONFIRMING') {
                        throw error;
                    }
                }

                try {
                    await this.repo.confirm(tx.txHash!, {
                        blockNumber: Number(receipt.blockNumber),
                        gasUsed: receipt.gasUsed,
                    });
                } catch (error) {
                    if (!(error instanceof TransactionStateConflictError)) {
                        throw error;
                    }

                    /*
                     * Another worker may have confirmed the transaction
                     * between markConfirming() and confirm().
                     */
                    const current = await this.repo.findById(tx.id, tx.tenantId);

                    if (!current) {
                        throw new Error(`Transaction ${tx.id} not found`);
                    }

                    if (
                        current.status === 'CONFIRMED' ||
                        current.status === 'FAILED' ||
                        current.status === 'EXPIRED'
                    ) {
                        getLogger().info(
                            {
                                transactionId: tx.id,
                                status: current.status,
                            },
                            'transaction.confirmation.stale',
                        );

                        return;
                    }

                    throw error;
                }

                incrementMetric(transactionsConfirmedTotal, {
                    tenantId: tx.tenantId,
                    tokenId: tx.tokenId,
                });

                getLogger().info(
                    {
                        status: 'CONFIRMED',
                        blockNumber: Number(receipt.blockNumber),
                    },
                    'transaction.confirmed',
                );

                return;
            }

            try {
                await this.repo.markFailed(tx.id, 'FAILED');
            } catch (error) {
                if (!(error instanceof TransactionStateConflictError)) {
                    throw error;
                }

                /*
                 * Another worker may already have resolved the transaction.
                 * Treat terminal state as an idempotent no-op.
                 */
                const current = await this.repo.findById(tx.id, tx.tenantId);

                if (!current) {
                    throw new Error(`Transaction ${tx.id} not found`);
                }

                if (
                    current.status === 'CONFIRMED' ||
                    current.status === 'FAILED' ||
                    current.status === 'EXPIRED'
                ) {
                    getLogger().info(
                        {
                            transactionId: tx.id,
                            status: current.status,
                        },
                        'transaction.confirmation.stale',
                    );

                    return;
                }

                throw error;
            }

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
        } catch (error) {
            /*
             * Receipt not available yet.
             *
             * BullMQ retry/backoff will handle retry.
             */
            if (error instanceof Error && error.message.includes('could not be found')) {
                throw error;
            }

            incrementMetric(transactionsFailedTotal, {
                tenantId: tx.tenantId,
                tokenId: tx.tokenId,
                status: 'CONFIRMATION_ERROR',
            });

            getLogger().error(
                {
                    error: error instanceof Error ? error.message : String(error),
                },
                'transaction.confirmation.failed',
            );

            throw error;
        } finally {
            updateContext({
                transactionId: undefined,
                tenantId: undefined,
                tokenId: undefined,
                txHash: undefined,
            });

            observeMetric(
                transactionConfirmationDurationSeconds,
                Number(process.hrtime.bigint() - startedAt) / 1_000_000_000,
                {
                    tenantId: tx.tenantId,
                    tokenId: tx.tokenId,
                },
            );
        }
    }
}
