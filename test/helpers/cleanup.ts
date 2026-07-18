import { prisma } from '../../src/database/prisma.js';

export async function cleanupDatabase() {
    await prisma.$executeRawUnsafe(`
        TRUNCATE TABLE
            "Transaction",
            "BalanceSnapshot",
            "TokenTransfer",
            "Wallet",
            "Token",
            "User"
        RESTART IDENTITY CASCADE;
    `);
}
