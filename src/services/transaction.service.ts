import { TransactionRepository } from "../repositories/transaction.repository.js";

export class TransactionService {
    constructor(
        private readonly repository: TransactionRepository
    ) {}

    async getById(id: string) {
        return this.repository.findById(id);
    }

    async list(
        tenantId: string,
        page = 1,
        limit = 20
    ) {
        return this.repository.findAll(
            tenantId,
            page,
            limit
        );
    }
}