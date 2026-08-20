import { Prisma, PrismaClient } from '@prisma/client';

export class IdempotencyKeyRepository {
    constructor(private readonly prisma: PrismaClient) {}

    async findByKey(tenantId: string, key: string) {
        return this.prisma.idempotencyKey.findUnique({
            where: {
                tenantId_key: {
                    tenantId,
                    key,
                },
            },
        });
    }

    async create(data: {
        tenantId: string;
        key: string;
        requestHash: string;
        status: string;
        expiresAt: Date;
    }) {
        return this.prisma.idempotencyKey.create({
            data,
        });
    }

    async markCompleted(id: string, transactionId: string, response: Prisma.InputJsonValue) {
        return this.prisma.idempotencyKey.update({
            where: { id },
            data: {
                transactionId,
                response,
                status: 'COMPLETED',
            },
        });
    }

    async markFailed(id: string, response?: Prisma.InputJsonValue) {
        return this.prisma.idempotencyKey.update({
            where: { id },
            data: {
                ...(response !== undefined ? { response } : {}),
                status: 'FAILED',
            },
        });
    }
}
