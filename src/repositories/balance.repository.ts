import { Prisma, type Blockchain } from '@prisma/client';
import { prisma } from '../database/prisma.js';

/** The fields the drift sweep needs to read one snapshot from the chain. */
export interface SnapshotForReconciliation {
    id: string;
    walletId: string;
    tokenId: string;
    wallet: { address: string; chainId: number };
    token: { blockchain: Blockchain; contractAddress: string | null; symbol: string };
}

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

    /**
     * One keyset-paginated page of snapshots for the drift sweep, with just
     * the wallet/token fields a chain read needs.
     *
     * Deliberately NOT filtered by `Token.isActive` or `Wallet.status`: the
     * event listener indexes every token (`prisma.token.findMany()`, no
     * `isActive` filter), so an inactive token's snapshots keep moving and
     * must keep being checked, and a suspended wallet's on-chain balance is
     * still real. Only `TokenRepository.findAll` filters on `isActive`.
     */
    async findPageForReconciliation(
        afterId: string | undefined,
        take: number,
    ): Promise<SnapshotForReconciliation[]> {
        return prisma.balanceSnapshot.findMany({
            select: {
                id: true,
                walletId: true,
                tokenId: true,
                wallet: { select: { address: true, chainId: true } },
                token: { select: { blockchain: true, contractAddress: true, symbol: true } },
            },
            orderBy: { id: 'asc' },
            take,
            ...(afterId ? { cursor: { id: afterId }, skip: 1 } : {}),
        });
    }
}
