import { prisma } from '../../src/database/prisma.js';
import { randomUUID } from 'crypto';
import { keccak256, toHex } from 'viem';

export async function createWallet(overrides: any = {}) {
    return prisma.wallet.create({
        data: {
            tenantId: overrides.tenantId,
            ownerId: overrides.ownerId,
            chainId: overrides.chainId ?? 31337,
            address: overrides.address ?? `0x${keccak256(toHex(randomUUID())).slice(2, 42)}`,
        },
    });
}
