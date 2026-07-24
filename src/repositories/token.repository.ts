import { prisma } from '../database/prisma.js';

export class TokenRepository {
    async create(data: {
        name: string;
        symbol: string;
        contractAddress: string;
        decimals?: number;
    }) {
        return prisma.token.create({
            data: {
                name: data.name,
                symbol: data.symbol,
                contractAddress: data.contractAddress.toLowerCase(),
                decimals: data.decimals ?? 6,
            },
        });
    }

    async findByContractAddress(contractAddress: string) {
        return prisma.token.findFirst({
            where: {
                contractAddress: {
                    equals: contractAddress.toLowerCase(),
                    mode: 'insensitive',
                },
            },
        });
    }

    async findById(id: string) {
        return prisma.token.findUnique({
            where: {
                id,
            },
        });
    }

    async findAll() {
        return prisma.token.findMany({
            orderBy: {
                createdAt: 'desc',
            },
        });
    }

    async exists(contractAddress: string) {
        const token = await prisma.token.findUnique({
            where: {
                contractAddress: contractAddress.toLowerCase(),
            },
        });
        return token !== null;
    }

    async updateContractAddress(id: string, contractAddress: string) {
        return prisma.token.update({
            where: {
                id,
            },
            data: {
                contractAddress,
            },
        });
    }

    async updateCheckpoint(tokenId: string, blockNumber: bigint) {
        return prisma.token.update({
            where: {
                id: tokenId,
            },
            data: {
                lastProcessedBlock: blockNumber,
            },
        });
    }
}
