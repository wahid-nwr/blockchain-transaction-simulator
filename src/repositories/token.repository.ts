import { Blockchain } from '@prisma/client';

import { prisma } from '../database/prisma.js';
import { normalizeContractAddress } from '../blockchain/token-identifier.js';

export class TokenRepository {
    async create(data: {
        name: string;
        symbol: string;
        contractAddress: string;
        decimals?: number;
        blockchain?: Blockchain;
    }) {
        const blockchain = data.blockchain ?? Blockchain.EVM;

        return prisma.token.create({
            data: {
                name: data.name,
                symbol: data.symbol,
                contractAddress: normalizeContractAddress(blockchain, data.contractAddress),
                decimals: data.decimals ?? 6,
                blockchain,
            },
        });
    }

    // blockchain defaults to EVM: every caller today (registration
    // validation aside) is either an EVM-only lookup path — see
    // transfer-event.service.ts, which only ever resolves EVM event-log
    // addresses this way — or explicitly passes the token's own
    // blockchain once one is known. Only EVM addresses are ever
    // case-folded (see token-identifier.ts); a non-EVM lookup compares
    // the identifier exactly as given.
    async findByContractAddress(contractAddress: string, blockchain: Blockchain = Blockchain.EVM) {
        const isCaseInsensitive = blockchain === Blockchain.EVM;

        return prisma.token.findFirst({
            where: {
                contractAddress: isCaseInsensitive
                    ? { equals: contractAddress.toLowerCase(), mode: 'insensitive' }
                    : contractAddress,
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
            where: {
                isActive: true,
            },
            orderBy: {
                createdAt: 'desc',
            },
        });
    }

    async exists(contractAddress: string, blockchain: Blockchain = Blockchain.EVM) {
        const token = await prisma.token.findUnique({
            where: {
                contractAddress: normalizeContractAddress(blockchain, contractAddress),
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
