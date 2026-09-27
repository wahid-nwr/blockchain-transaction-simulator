import { Prisma } from '@prisma/client';
import { prisma } from '../database/prisma.js';

export class BalanceRepository {
    async find(walletId: string, tokenId: string) {
        return prisma.balanceSnapshot.findUnique({
            where: {
                walletId_tokenId: {
                    walletId,
                    tokenId,
                },
            },
        });
    }

    async upsert(data: {
        walletId: string;
        tokenId: string;
        balance: bigint;
        blockNumber: bigint;
    }) {
        // A balance snapshot is a monotonic projection of chain state.
        // Never allow a replayed/older event to move the snapshot backwards.
        const updated = await prisma.balanceSnapshot.updateMany({
            where: {
                walletId: data.walletId,
                tokenId: data.tokenId,
                blockNumber: {
                    lt: data.blockNumber,
                },
            },
            data: {
                balance: data.balance,
                blockNumber: data.blockNumber,
            },
        });

        if (updated.count > 0) {
            return prisma.balanceSnapshot.findUniqueOrThrow({
                where: {
                    walletId_tokenId: {
                        walletId: data.walletId,
                        tokenId: data.tokenId,
                    },
                },
            });
        }

        try {
            return await prisma.balanceSnapshot.create({
                data: {
                    walletId: data.walletId,
                    tokenId: data.tokenId,
                    balance: data.balance,
                    blockNumber: data.blockNumber,
                },
            });
        } catch (error) {
            // Another worker may have created the snapshot concurrently.
            // Re-read it rather than turning an expected uniqueness race into
            // a processing failure.
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
                return prisma.balanceSnapshot.findUniqueOrThrow({
                    where: {
                        walletId_tokenId: {
                            walletId: data.walletId,
                            tokenId: data.tokenId,
                        },
                    },
                });
            }

            throw error;
        }
    }

    async findByWallet(walletId: string) {
        return prisma.balanceSnapshot.findMany({
            where: {
                walletId,
            },
            include: {
                token: true,
            },
            orderBy: {
                token: {
                    symbol: 'asc',
                },
            },
        });
    }
}
