import { TransactionRepository } from '../repositories/transaction.repository.js';
import { CreatePendingTransactionRequest } from './dto/pending.transaction.js';
import { logTransactionEvent } from '../observability/transaction.logger.js';
import { TransactionStatus } from '@prisma/client';

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
        return transaction;
    }

    async attachHash(id: string, txHash: string) {
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
