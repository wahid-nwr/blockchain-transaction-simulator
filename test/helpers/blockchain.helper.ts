import { prisma } from '../../src/database/prisma.js';

export async function waitForTransactionConfirmation(
    transactionId: string,
    timeout = 30000,
    interval = 250,
) {
    const start = Date.now();

    while (Date.now() - start < timeout) {
        const transaction = await prisma.transaction.findUnique({
            where: {
                id: transactionId,
            },
        });

        if (!transaction) {
            throw new Error(`Transaction ${transactionId} not found`);
        }

        if (transaction.status === 'CONFIRMED') {
            return transaction;
        }

        if (transaction.status === 'FAILED') {
            throw new Error(`Transaction ${transactionId} failed`);
        }

        await new Promise((resolve) => setTimeout(resolve, interval));
    }

    throw new Error(`Transaction ${transactionId} confirmation timeout`);
}
