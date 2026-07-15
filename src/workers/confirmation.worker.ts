import { publicClient } from "../blockchain/client.js";
import { TransactionRepository } from "../repositories/transaction.repository.js";

export class ConfirmationWorker {
    constructor(
        private readonly repo:TransactionRepository
    ) {}

    async process() {
        const pending = await this.repo.findPending();
        for (const tx of pending) {
            if(!tx.txHash) continue;
            const receipt = await publicClient.getTransactionReceipt({
                    hash: tx.txHash as `0x${string}`
                });
            if (receipt.status==="success") {
                await this.repo.updateStatus(
                    tx.txHash,
                    "CONFIRMED"
                );
            } else {
                await this.repo.updateStatus(
                    tx.txHash,
                    "FAILED"
                );
            }
        }
    }
}