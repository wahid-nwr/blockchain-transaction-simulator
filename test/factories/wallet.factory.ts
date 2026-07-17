import { prisma } from "../../src/database/prisma.js";

export async function createWallet(
    overrides:any = {}
) {
    return prisma.wallet.create({
        data:{
            tenantId: overrides.tenantId,
            ownerId: overrides.ownerId,
            chainId: overrides.chainId ?? 31337,
            address:
                overrides.address ??
                `0xwallet-${Date.now()}`
        }
    });
}