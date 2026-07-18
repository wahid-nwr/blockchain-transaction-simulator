import { TransactionRepository } from '../repositories/transaction.repository.js';
import { CreatePendingTransactionRequest } from './dto/pending.transaction.js';

export class LedgerService {
    constructor(private readonly repository: TransactionRepository) {}

    async createPending(data: CreatePendingTransactionRequest) {
        return this.repository.create({
            ...data,
            status: 'PENDING',
        });
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

    async markFailed(id: string) {
        return this.repository.markFailed(id);
    }
}
