export class LedgerService {
    constructor(
        private readonly repository: TransactionRepository
    ) {}

    async createPending(
        data:any
    ) {
        return this.repository.create({
            ...data,
            status: "PENDING"
        });
    }

    async confirm(
        txHash:string
    ) {
        return this.repository.updateStatus(
            txHash,
            "CONFIRMED"
        );
    }
}