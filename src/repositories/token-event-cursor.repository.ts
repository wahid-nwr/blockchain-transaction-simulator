import { prisma } from '../database/prisma.js';

export class TokenEventCursorRepository {
    async getOrCreate(tokenId: string) {
        return prisma.tokenEventCursor.upsert({
            where: {
                tokenId,
            },

            create: {
                tokenId,
                lastProcessedBlock: 0n,
            },

            update: {},
        });
    }

    async markSuccess(tokenId: string, blockNumber: bigint) {
        return prisma.tokenEventCursor.update({
            where: {
                tokenId,
            },

            data: {
                lastProcessedBlock: blockNumber,

                lastSuccessfulSync: new Date(),

                failureCount: 0,
            },
        });
    }

    async markFailure(tokenId: string) {
        return prisma.tokenEventCursor.update({
            where: {
                tokenId,
            },

            data: {
                lastFailedSync: new Date(),

                failureCount: {
                    increment: 1,
                },
            },
        });
    }

    async updateCursor(
        tokenId: string,
        blockNumber: bigint,
        logIndex: number,
    ) {
        return prisma.tokenEventCursor.update({
            where: {
                tokenId,
            },
            data: {
                lastProcessedBlock: blockNumber,
                lastProcessedLogIndex: logIndex,
            },
        });
    }

    async findByTokenId(tokenId: string) {
        return prisma.tokenEventCursor.findUnique({
            where: {
                tokenId,
            },
        });
    }
}
