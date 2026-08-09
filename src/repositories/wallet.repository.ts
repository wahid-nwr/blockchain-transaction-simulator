import { prisma } from '../database/prisma.js';

export class WalletRepository {
    create(data: { tenantId: string; ownerId: string; chainId: number; address: string }) {
        return prisma.wallet.create({
            data: {
                tenantId: data.tenantId,
                ownerId: data.ownerId,
                chainId: data.chainId,
                address: data.address.toLowerCase(),
            },
        });
    }

    findByIdForTenant(id: string, tenantId: string) {
        return prisma.wallet.findFirst({
            where: { id, tenantId },
        });
    }

    // Only the signing path should call this — it's the sole method that can
    // return key-custody material (still encrypted at rest, but still).
    findByIdForTenantWithCustody(id: string, tenantId: string) {
        return prisma.wallet.findFirst({
            where: { id, tenantId },
            include: { custodyKey: true },
        });
    }

    findByOwnerId(ownerId: string) {
        return prisma.wallet.findMany({
            where: {
                ownerId,
            },
        });
    }

    findById(id: string) {
        return prisma.wallet.findUnique({
            where: {
                id,
            },
        });
    }

    findByAddress(address: string) {
        return prisma.wallet.findFirst({
            where: {
                address: {
                    equals: address,
                    mode: 'insensitive',
                },
            },
        });
    }
}
