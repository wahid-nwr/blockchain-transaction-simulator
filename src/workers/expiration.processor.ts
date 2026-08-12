import { TransactionRepository } from '../repositories/transaction.repository.js';
import { getLogger } from '../observability/logger.js';
import { TransactionStateConflictError } from '../common/errors/transaction-state-conflict.error.js';


export class ExpirationProcessor {
    private static readonly NAME = 'expiration-processor';

    constructor(private readonly repo: TransactionRepository) {}

    async processExpiredTransactions(expirationBefore: Date) {
        const transactions = await this.repo.findExpiredCandidates(expirationBefore);

        for (const transaction of transactions) {
            await this.expire(transaction);
        }

        return transactions.length;
    }

    private async expire(transaction: { id: string; tenantId: string; tokenId: string }) {
        try {
            await this.repo.expire(transaction.id, 'Transaction confirmation timeout exceeded');

            getLogger().warn(
                {
                    worker: ExpirationProcessor.NAME,
                    transactionId: transaction.id,
                    tenantId: transaction.tenantId,
                },
                'transaction.expired',
            );
        } catch (error) {
            if (error instanceof TransactionStateConflictError) {
                getLogger().info(
                    {
                        transactionId: transaction.id,
                    },
                    'transaction.expiration.stale',
                );

                return;
            }

            getLogger().error(
                {
                    transactionId: transaction.id,
                    error: error instanceof Error ? error.message : String(error),
                },
                'transaction.expiration.failed',
            );

            throw error;
        }
    }
}
