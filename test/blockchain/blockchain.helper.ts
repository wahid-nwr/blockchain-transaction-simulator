import { TransactionStatus } from '@prisma/client';
import { prisma } from '../../src/database/prisma.js';

export async function waitForTransactionStatus(
    transactionId: string,
    expectedStatus: TransactionStatus,
    timeoutMs = 30_000,
    intervalMs = 250,
) {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
        const transaction = await prisma.transaction.findUnique({
            where: {
                id: transactionId,
            },
        });

        if (transaction?.status === expectedStatus) {
            return transaction;
        }

        await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }

    const transaction = await prisma.transaction.findUnique({
        where: {
            id: transactionId,
        },
    });

    throw new Error(
        `Timed out waiting for transaction ${transactionId} to reach ${expectedStatus}; ` +
            `current status: ${transaction?.status ?? 'NOT_FOUND'}`,
    );
}
