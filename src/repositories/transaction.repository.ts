import { prisma } from '../database/prisma.js';
import { Prisma, PrismaClient, TransactionStatus } from '@prisma/client';

import { TransactionStateMachine } from '../domain/transaction/transaction-state-machine.js';

import { TransactionStateConflictError } from '../common/errors/transaction-state-conflict.error.js';

export class TransactionRepository {
    create(data: Prisma.TransactionUncheckedCreateInput) {
        return prisma.transaction.create({
            data,
        });
    }

    private async transition(
        transactionId: string,
        from: TransactionStatus,
        to: TransactionStatus,
        data: Prisma.TransactionUpdateInput = {},
        tx?: Omit<
            PrismaClient,
            '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
        >,
    ) {
        TransactionStateMachine.assertTransition(from, to);

        const client = tx ?? prisma;

        const result = await client.transaction.updateMany({
            where: {
                id: transactionId,
                status: from,
            },
            data: {
                status: to,
                ...data,
            },
        });

        if (result.count === 1) {
            return client.transaction.findUniqueOrThrow({
                where: {
                    id: transactionId,
                },
            });
        }

        const transaction = await client.transaction.findUnique({
            where: {
                id: transactionId,
            },
        });

        if (!transaction) {
            throw new Error(`Transaction ${transactionId} not found`);
        }

        throw new TransactionStateConflictError(transactionId, from);
    }

    private async transitionFromAny(
        transactionId: string,
        from: TransactionStatus[],
        to: TransactionStatus,
        data: Prisma.TransactionUpdateInput = {},
    ) {
        for (const source of from) {
            TransactionStateMachine.assertTransition(source, to);
        }

        const result = await prisma.transaction.updateMany({
            where: {
                id: transactionId,
                status: {
                    in: from,
                },
            },
            data: {
                status: to,
                ...data,
            },
        });

        if (result.count === 1) {
            return prisma.transaction.findUniqueOrThrow({
                where: {
                    id: transactionId,
                },
            });
        }

        const transaction = await prisma.transaction.findUnique({
            where: {
                id: transactionId,
            },
        });

        if (!transaction) {
            throw new Error(`Transaction ${transactionId} not found`);
        }

        throw new TransactionStateConflictError(transactionId, transaction.status);
    }

    async markSubmitted(transactionId: string, txHash: string) {
        return this.transition(
            transactionId,
            TransactionStatus.PENDING,
            TransactionStatus.SUBMITTED,
            {
                txHash,
                submittedAt: new Date(),
            },
        );
    }

    async markConfirming(transactionId: string) {
        return this.transition(
            transactionId,
            TransactionStatus.SUBMITTED,
            TransactionStatus.CONFIRMING,
            {
                confirmationStartedAt: new Date(),
            },
        );
    }

    async confirm(
        txHash: string,
        data: {
            blockNumber: number;
            gasUsed: bigint;
        },
        tx?: Omit<
            PrismaClient,
            '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
        >,
    ) {
        const client = tx ?? prisma;

        const transaction = await client.transaction.findUnique({
            where: {
                txHash,
            },
        });

        if (!transaction) {
            throw new Error(`Transaction with hash ${txHash} not found`);
        }

        return this.transition(
            transaction.id,
            TransactionStatus.CONFIRMING,
            TransactionStatus.CONFIRMED,
            {
                blockNumber: data.blockNumber,
                gasUsed: data.gasUsed,
                confirmedAt: new Date(),
            },
            tx,
        );
    }

    async markFailed(id: string, reason: string) {
        return this.transitionFromAny(
            id,
            [TransactionStatus.PENDING, TransactionStatus.CONFIRMING],
            TransactionStatus.FAILED,
            {
                failureReason: reason,
                failedAt: new Date(),
            },
        );
    }

    async expire(transactionId: string, reason: string) {
        return this.transition(
            transactionId,
            TransactionStatus.CONFIRMING,
            TransactionStatus.EXPIRED,
            {
                failureReason: reason,
                failedAt: new Date(),
            },
        );
    }

    findByHash(txHash: string) {
        return prisma.transaction.findUnique({
            where: {
                txHash,
            },
        });
    }

    async findPending() {
        return prisma.transaction.findMany({
            where: {
                status: TransactionStatus.PENDING,
                txHash: {
                    not: null,
                },
            },
        });
    }

    async findById(id: string, tenantId: string) {
        return prisma.transaction.findUnique({
            where: {
                id,
                tenantId,
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

    async findExpiredCandidates(expirationBefore: Date, limit = 100) {
        return prisma.transaction.findMany({
            where: {
                status: TransactionStatus.CONFIRMING,
                confirmationStartedAt: {
                    lte: expirationBefore,
                },
            },
            orderBy: {
                confirmationStartedAt: 'asc',
            },
            take: limit,
        });
    }

    async findSubmittedCandidates(limit = 100) {
        return prisma.transaction.findMany({
            where: {
                status: TransactionStatus.SUBMITTED,
                txHash: {
                    not: null,
                },
            },
            orderBy: {
                submittedAt: 'asc',
            },
            take: limit,
        });
    }
}
