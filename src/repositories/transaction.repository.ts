import { prisma } from '../database/prisma.js';
import { Prisma, TransactionStatus } from '@prisma/client';

export class TransactionRepository {
    create(data: Prisma.TransactionUncheckedCreateInput) {
        return prisma.transaction.create({
            data,
        });
    }

    updateStatus(txHash: string, status: TransactionStatus) {
        return prisma.transaction.update({
            where: {
                txHash,
            },
            data: {
                status,
                confirmedAt: status === 'CONFIRMED' ? new Date() : undefined,
            },
        });
    }

    async confirm(
        txHash: string,
        data: {
            blockNumber: number;
            gasUsed: bigint;
        },
    ) {
        return prisma.transaction.update({
            where: {
                txHash,
            },
            data: {
                status: 'CONFIRMED',
                blockNumber: data.blockNumber,
                gasUsed: data.gasUsed,
                confirmedAt: new Date(),
            },
        });
    }

    findByHash(txHash: string) {
        return prisma.transaction.findUnique({
            where: {
                txHash,
            },
        });
    }

    async attachHash(id: string, txHash: string) {
        return prisma.transaction.update({
            where: {
                id,
            },
            data: {
                txHash,
            },
        });
    }

    async markFailed(id: string) {
        return prisma.transaction.update({
            where: {
                id,
            },
            data: {
                status: 'FAILED',
            },
        });
    }

    async findPending() {
        return prisma.transaction.findMany({
            where: {
                status: 'PENDING',
                txHash: {
                    not: null,
                },
            },
        });
    }

    async findById(id: string, tenantId: string) {
        return prisma.transaction.findUnique({
            where: {
                id: id,
                tenantId: tenantId
            },
            include: {
                token: true,
                fromWallet: true,
                toWallet: true,
            },
        });
    }

    async findAll(tenantId: string, page = 1, limit = 20) {
        return prisma.transaction.findMany({
            where: {
                tenantId,
            },
            include: {
                token: true,
                fromWallet: true,
                toWallet: true,
            },
            orderBy: {
                createdAt: 'desc',
            },
            skip: (page - 1) * limit,
            take: limit,
        });
    }
}
