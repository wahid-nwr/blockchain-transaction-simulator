import { prisma } from '../../src/database/prisma.js';

export async function createBalanceSnapshot(overrides: any = {}) {
    return prisma.balanceSnapshot.create({
        data: {
            walletId: overrides.walletId,
            tokenId: overrides.tokenId,

            balance: overrides.balance ?? 1000n,

            blockNumber: overrides.blockNumber ?? 100n,
        },
    });
}
