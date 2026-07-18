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
