import { prisma } from '../../src/database/prisma.js';

export async function cleanupDatabase() {
    await prisma.$executeRawUnsafe(`
        TRUNCATE TABLE
            "TokenTransfer",
            "Transaction",
            "BalanceSnapshot",
            "Wallet",
            "Token",
            "User"
        RESTART IDENTITY CASCADE;
    `);
}
