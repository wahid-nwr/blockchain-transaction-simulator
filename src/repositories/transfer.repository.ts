import { prisma } from '../database/prisma.js';

export class TransferRepository {
    async create(data: {
        tokenId: string;
        from: string;
        to: string;
        amount: bigint;
        transactionHash: string;
        logIndex: number;
        blockNumber: bigint;
    }) {
        return await prisma.tokenTransfer.upsert({
            where: {
                transactionHash_logIndex: {
                    transactionHash: data.transactionHash,
                    logIndex: data.logIndex,
                },
            },
            create: data,
            update: {},
        });
    }

    async findByTransactionHashAndLogIndex(transactionHash: string, logIndex: number) {
        return prisma.tokenTransfer.findUnique({
            where: {
                transactionHash_logIndex: {
                    transactionHash,
                    logIndex,
                },
            },
        });
    }
}
