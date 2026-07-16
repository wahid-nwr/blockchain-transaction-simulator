import { publicClient } from "../blockchain/client.js";
import { TransactionRepository } from "../repositories/transaction.repository.js";

async function main() {
    const worker = new ConfirmationWorker(
        new TransactionRepository()
    );

    await worker.process();

    console.log("Confirmation worker completed");
}

export class ConfirmationWorker {
    constructor(
        private readonly repo: TransactionRepository
    ) {}

    async process() {
        const pending = await this.repo.findPending();

        console.log(`Found ${pending.length} pending transaction(s)`);

        for (const tx of pending) {
            console.log(`Processing ${tx.txHash}`);

            if (!tx.txHash) continue;

            const receipt = await publicClient.getTransactionReceipt({
                hash: tx.txHash as `0x${string}`
            });

            console.log(receipt);

            if (receipt.status === "success") {
                await this.repo.confirm(tx.txHash, {
                    blockNumber: Number(receipt.blockNumber),
                    gasUsed: receipt.gasUsed
                });

                console.log(`Confirmed ${tx.txHash}`);
            } else {
                await this.repo.updateStatus(tx.txHash, "FAILED");

                console.log(`Failed ${tx.txHash}`);
            }
        }
    }
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});