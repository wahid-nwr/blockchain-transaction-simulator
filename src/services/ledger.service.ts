import { TransactionRepository } from "../repositories/transaction.repository.js";

export class LedgerService {
    constructor(
        private readonly repository: TransactionRepository
    ) {}

    async createPending(
        data: any
    ) {
        return this.repository.create({
            ...data,
            status: "PENDING"
        });
    }

    async attachHash(
        id: string,
        txHash: string
    ) {
        return this.repository.attachHash(
            id,
            txHash
        );
    }

    async confirm(
        txHash: string
    ) {
        return this.repository.updateStatus(
            txHash,
            "CONFIRMED"
        );
    }

    async markFailed(
        id: string
    ) {
        return this.repository.markFailed(
            id
        );
    }
}