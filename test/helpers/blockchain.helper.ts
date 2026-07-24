import { prisma } from '../../src/database/prisma.js';
import { ConfirmationWorker } from '../../src/workers/confirmation.worker.js';
import { TransactionRepository } from '../../src/repositories/transaction.repository.js';
import { start as startEventListener } from '../../src/workers/event.listener.js';

export async function waitForTransactionConfirmation(
    transactionId: string,
    timeout = 30000,
    interval = 250,
) {
    const worker = new ConfirmationWorker(new TransactionRepository());

    const start = Date.now();

    while (Date.now() - start < timeout) {
        await worker.process();

        const transaction = await prisma.transaction.findUnique({
            where: {
                id: transactionId,
            },
        });

        if (!transaction) {
            throw new Error(`Transaction ${transactionId} not found`);
        }

        if (transaction.status === 'CONFIRMED' || transaction.status === 'FAILED') {
            return transaction;
        }

        await new Promise((resolve) => setTimeout(resolve, interval));
    }

    throw new Error(`Transaction ${transactionId} confirmation timeout`);
}

export async function waitForEventIndexing(tokenId: string, expectedCount: number, retries = 20) {
    const token = await prisma.token.findUnique({
        where: {
            id: tokenId,
        },
    });

    console.log('WAIT INDEX CURSOR', {
        lastProcessedBlock: token?.lastProcessedBlock,
    });
    for (let i = 0; i < retries; i++) {
        await startEventListener(tokenId);

        const count = await prisma.tokenTransfer.count({
            where: {
                tokenId,
            },
        });

        console.log('EVENT INDEX COUNT', {
            tokenId,
            count,
            expectedCount,
        });

        if (count >= expectedCount) {
            return;
        }

        await new Promise((r) => setTimeout(r, 200));
    }

    throw new Error(`Transfer event indexing timeout for token ${tokenId}`);
}
