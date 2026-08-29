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
import { withSpan } from '../observability/tracing.js';

import { Transaction } from '@prisma/client';
import { TransactionStateConflictError } from '../common/errors/transaction-state-conflict.error.js';
import { outboxEventService } from '../services/outbox-event.service.js';
import { prisma } from '../database/prisma.js';

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

        this.setContext(tx);
        this.logConfirmationStarted();

        try {
            // withSpan (rather than a plain startSpan/end pair) so that the
            // RPC span started inside getTransactionReceipt() — and any
            // future work added inside this block — nests underneath
            // "transaction.confirm" instead of appearing as an unrelated
            // root span. This is the trace boundary an on-call engineer
            // would actually want to pivot from: "why is this transaction
            // stuck confirming" -> is the time in our DB, in BullMQ, or in
            // the RPC call itself.
            await withSpan(
                'transaction.confirm',
                async () => {
                    const receipt = await this.getTransactionReceipt(tx);

                    if (receipt.status === 'success') {
                        await this.handleSuccessfulReceipt(tx, receipt);
                        return;
                    }

                    await this.handleRevertedReceipt(tx);
                },
                {
                    'transaction.id': tx.id,
                    'transaction.tenant_id': tx.tenantId,
                    'transaction.token_id': tx.tokenId,
                },
            );
        } catch (error) {
            this.handleConfirmationError(tx, error);
        } finally {
            this.clearContext();

            this.observeConfirmationDuration(tx, startedAt);
        }
    }

    private async getTransactionReceipt(tx: Transaction) {
        return executeRpc('getTransactionReceipt', () =>
            publicClient.getTransactionReceipt({
                hash: tx.txHash as `0x${string}`,
            }),
        );
    }

    private async handleSuccessfulReceipt(
        tx: Transaction,
        receipt: Awaited<ReturnType<typeof this.getTransactionReceipt>>,
    ) {
        const claimed = await this.claimConfirmation(tx);

        if (!claimed) {
            return;
        }

        await this.persistConfirmation(tx, receipt);

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
    }

    private async claimConfirmation(tx: Transaction): Promise<boolean> {
        try {
            await this.repo.markConfirming(tx.id);

            return true;
        } catch (error) {
            if (!(error instanceof TransactionStateConflictError)) {
                throw error;
            }

            return this.handleStaleConfirmation(tx, error);
        }
    }

    private async handleStaleConfirmation(
        tx: Transaction,
        error: TransactionStateConflictError,
    ): Promise<boolean> {
        const current = await this.repo.findById(tx.id, tx.tenantId);

        if (!current) {
            throw new Error(`Transaction ${tx.id} not found`);
        }

        if (this.isTerminal(current.status)) {
            this.logStaleConfirmation(tx, current.status);

            return false;
        }

        /*
         * Another worker already claimed the transaction.
         *
         * It is now CONFIRMING, so this worker may safely
         * continue toward confirmation.
         */
        if (current.status === 'CONFIRMING') {
            return true;
        }

        throw error;
    }

    private isTerminal(status: Transaction['status']) {
        return status === 'CONFIRMED' || status === 'FAILED' || status === 'EXPIRED';
    }

    private async persistConfirmation(
        tx: Transaction,
        receipt: Awaited<ReturnType<typeof this.getTransactionReceipt>>,
    ) {
        try {
            await prisma.$transaction(async (txClient) => {
                const confirmed = await this.repo.confirm(
                    tx.txHash!,
                    {
                        blockNumber: Number(receipt.blockNumber),
                        gasUsed: receipt.gasUsed,
                    },
                    txClient,
                );

                await outboxEventService.createInTransaction(txClient, {
                    aggregateId: confirmed.id,
                    type: 'transaction.confirmed',
                    payload: {
                        transactionId: confirmed.id,
                        tenantId: confirmed.tenantId,
                        tokenId: confirmed.tokenId,
                        txHash: confirmed.txHash,
                        blockNumber: confirmed.blockNumber?.toString() ?? null,
                        amount: confirmed.amount.toString(),
                        confirmedAt: confirmed.confirmedAt?.toISOString() ?? null,
                    },
                });
            });
        } catch (error) {
            if (!(error instanceof TransactionStateConflictError)) {
                throw error;
            }

            const current = await this.repo.findById(tx.id, tx.tenantId);

            if (!current) {
                throw new Error(`Transaction ${tx.id} not found`);
            }

            if (this.isTerminal(current.status)) {
                this.logStaleConfirmation(tx, current.status);

                return;
            }

            throw error;
        }
    }

    private async handleRevertedReceipt(tx: Transaction) {
        const failed = await this.markTransactionFailed(tx);

        if (!failed) {
            return;
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
    }

    private async markTransactionFailed(tx: Transaction): Promise<boolean> {
        try {
            await this.repo.markFailed(tx.id, 'FAILED');

            return true;
        } catch (error) {
            if (!(error instanceof TransactionStateConflictError)) {
                throw error;
            }

            const current = await this.repo.findById(tx.id, tx.tenantId);

            if (!current) {
                throw new Error(`Transaction ${tx.id} not found`);
            }

            if (this.isTerminal(current.status)) {
                this.logStaleConfirmation(tx, current.status);

                return false;
            }

            throw error;
        }
    }

    private logStaleConfirmation(tx: Transaction, status: Transaction['status']) {
        getLogger().info(
            {
                transactionId: tx.id,
                status,
            },
            'transaction.confirmation.stale',
        );
    }

    private handleConfirmationError(tx: Transaction, error: unknown): never {
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
    }

    private setContext(tx: Transaction) {
        updateContext({
            transactionId: tx.id,
            txHash: tx.txHash ?? undefined,
            tenantId: tx.tenantId,
            tokenId: tx.tokenId,
        });
    }

    private logConfirmationStarted() {
        getLogger().info(
            {
                worker: ConfirmationProcessor.NAME,
            },
            'transaction.confirmation.started',
        );
    }

    private clearContext() {
        updateContext({
            transactionId: undefined,
            tenantId: undefined,
            tokenId: undefined,
            txHash: undefined,
        });
    }

    private observeConfirmationDuration(tx: Transaction, startedAt: bigint) {
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
