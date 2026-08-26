import { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../database/prisma.js';

export interface OutboxEventData {
    aggregateId: string;
    type: string;
    payload: Prisma.InputJsonValue;
}

export class OutboxEventRepository {
    /**
     * Write an outbox event inside an existing Prisma transaction.
     *
     * Callers must pass the `tx` handle from `prisma.$transaction(...)` so
     * the event write and the business state change are committed atomically.
     * This is the core transactional-outbox guarantee: an event is either
     * published-eventually OR the business operation it describes was rolled
     * back — never one without the other.
     */
    async createInTransaction(
        tx: Omit<
            PrismaClient,
            '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
        >,
        data: OutboxEventData,
    ) {
        return tx.outboxEvent.create({
            data: {
                aggregateId: data.aggregateId,
                type: data.type,
                payload: data.payload,
                published: false,
            },
        });
    }

    /**
     * Claim the next batch of unpublished events, oldest-first.
     * The relay calls this in a tight loop; the composite index on
     * (published, createdAt) makes this cheap.
     */
    async claimUnpublished(limit = 50) {
        return prisma.outboxEvent.findMany({
            where: { published: false },
            orderBy: { createdAt: 'asc' },
            take: limit,
        });
    }

    async markPublished(ids: string[]) {
        if (ids.length === 0) return;

        await prisma.outboxEvent.updateMany({
            where: { id: { in: ids } },
            data: { published: true, publishedAt: new Date() },
        });
    }
}
