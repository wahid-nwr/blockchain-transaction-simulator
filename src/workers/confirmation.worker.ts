import { publicClient } from '../blockchain/client.js';
import { TransactionRepository } from '../repositories/transaction.repository.js';
import { randomUUID } from 'node:crypto';

import { logTransactionEvent } from '../observability/transaction.logger.js';

async function main() {
    const worker = new ConfirmationWorker(new TransactionRepository());

    await worker.process();
}

export class ConfirmationWorker {
    constructor(private readonly repo: TransactionRepository) {}

    async process() {
        const worker = 'confirmation-worker';

        const cycleId = randomUUID();

        const startedAt = process.hrtime.bigint();

        logTransactionEvent('worker.cycle.started', {
            worker,
            cycleId,
        });

        const pending = await this.repo.findPending();

        for (const tx of pending) {
            if (!tx.txHash) continue;

            try {
                const confirmationStartedAt = process.hrtime.bigint();

                logTransactionEvent('transaction.confirmation.started', {
                    worker,
                    cycleId,
                    transactionId: tx.id,
                    tenantId: tx.tenantId,
                    tokenId: tx.tokenId,
                    txHash: tx.txHash ?? undefined,
                });
                const receipt = await publicClient.getTransactionReceipt({
                    hash: tx.txHash as `0x${string}`,
                });

                if (receipt.status === 'success') {
                    await this.repo.confirm(tx.txHash, {
                        blockNumber: Number(receipt.blockNumber),
                        gasUsed: receipt.gasUsed,
                    });

                    const durationMs = Number(process.hrtime.bigint() - confirmationStartedAt) / 1_000_000;

                    logTransactionEvent('transaction.confirmed', {
                        worker,
                        cycleId,
                        transactionId: tx.id,
                        tenantId: tx.tenantId,
                        tokenId: tx.tokenId,
                        txHash: tx.txHash ?? undefined,
                        blockNumber: Number(receipt.blockNumber),
                        status: 'CONFIRMED',
                        durationMs,
                    });
                } else {
                    await this.repo.updateStatus(tx.txHash, 'FAILED');
                    logTransactionEvent('transaction.reverted', {
                        worker,
                        cycleId,
                        transactionId: tx.id,
                        txHash: tx.txHash ?? undefined,
                        status: 'FAILED',
                    });
                }
            } catch (error) {
                if (error instanceof Error && error.message.includes('could not be found')) {
                    return;
                }

                logTransactionEvent('transaction.reverted', {
                    worker,
                    cycleId,
                    transactionId: tx.id,
                    txHash: tx.txHash ?? undefined,
                    status: 'FAILED',
                });
            }
        }
        const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;

        logTransactionEvent('worker.cycle.completed', {
            worker,
            cycleId,
            durationMs,
        });
    }
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch((error) => {
        console.error(error);
        process.exit(1);
    });
}
