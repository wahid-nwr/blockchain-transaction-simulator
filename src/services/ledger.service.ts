import { TransactionRepository } from '../repositories/transaction.repository.js';
import { CreatePendingTransactionRequest } from './dto/pending.transaction.js';
import { logTransactionEvent } from '../observability/transaction.logger.js';
import { TransactionStatus } from '@prisma/client';
import { incrementMetric } from '../observability/metrics.js';
import { transactionsCreatedTotal } from '../observability/transaction.metrics.js';
import { updateContext } from '../observability/context.js';

export class LedgerService {
    constructor(private readonly repository: TransactionRepository) {}

    async createPending(data: CreatePendingTransactionRequest) {
        const transaction = await this.repository.create({
            ...data,
            status: TransactionStatus.PENDING,
        });
        logTransactionEvent('transaction.create', {
            tenantId: transaction.tenantId,
            transactionId: transaction.id,
            tokenId: transaction.tokenId,
            walletId: transaction.fromWalletId,
            amount: transaction.amount,
            status: TransactionStatus.PENDING,
        });
        incrementMetric(transactionsCreatedTotal, {
            tenantId: transaction.tenantId,
            tokenId: transaction.tokenId,
        });
        updateContext({
            transactionId: transaction.id,
        });
        return transaction;
    }

    async attachHash(id: string, txHash: string) {
        updateContext({
            txHash,
        });
        return this.repository.attachHash(id, txHash);
    }

    async confirm(
        txHash: string,
        receipt: {
            blockNumber: bigint;
            gasUsed: bigint;
        },
    ) {
        return this.repository.confirm(txHash, {
            blockNumber: Number(receipt.blockNumber),
            gasUsed: receipt.gasUsed,
        });
    }

    async markFailed(id: string, reason: string) {
        return this.repository.markFailed(id, reason);
    }
}
