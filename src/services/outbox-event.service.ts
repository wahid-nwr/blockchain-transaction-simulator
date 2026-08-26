import { PrismaClient } from '@prisma/client';
import { OutboxEventRepository, OutboxEventData } from '../repositories/outbox-event.repository.js';
import { outboxRelayQueue } from '../queues/outbox-relay.queue.js';
import { getLogger } from '../observability/logger.js';

export class OutboxEventService {
    constructor(private readonly repository: OutboxEventRepository) {}

    /**
     * Write an outbox event atomically with the business state change.
     *
     * Usage — inside a `prisma.$transaction(async (tx) => { ... })` block:
     *
     * ```ts
     * await outboxEventService.createInTransaction(tx, {
     *   aggregateId: transaction.id,
     *   type: 'transaction.confirmed',
     *   payload: { transactionId: transaction.id, txHash: transaction.txHash },
     * });
     * ```
     *
     * The relay scheduler picks this up and enqueues it to BullMQ, which
     * delivers it to downstream consumers. If the relay hasn't run yet the
     * row stays `published: false` — no event is silently lost.
     */
    async createInTransaction(
        tx: Omit<
            PrismaClient,
            '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
        >,
        data: OutboxEventData,
    ) {
        return this.repository.createInTransaction(tx, data);
    }

    /**
     * Claim unpublished events and enqueue them into BullMQ.
     *
     * Called by the OutboxRelayScheduler on each tick. Enqueue-then-mark
     * is the correct order: if the process dies after enqueue but before
     * mark, the scheduler picks the row up again on the next tick and
     * re-enqueues — BullMQ deduplication (job ID == outboxEventId) ensures
     * only one copy is ever processed.
     */
    async relay(limit = 50): Promise<number> {
        const events = await this.repository.claimUnpublished(limit);

        if (events.length === 0) {
            return 0;
        }

        const jobs = events.map((event) => ({
            name: event.type,
            data: {
                outboxEventId: event.id,
                aggregateId: event.aggregateId,
                type: event.type,
                payload: event.payload,
            },
            opts: {
                // Use the outbox event ID as the BullMQ job ID so that
                // re-enqueueing an already-queued event is a no-op rather
                // than a duplicate job. BullMQ silently ignores addBulk
                // entries whose job ID already exists in the queue.
                jobId: event.id,
            },
        }));

        await outboxRelayQueue.addBulk(jobs);

        const publishedIds = events.map((e) => e.id);
        await this.repository.markPublished(publishedIds);

        getLogger().info({ count: publishedIds.length }, 'outbox.relay.enqueued');

        return publishedIds.length;
    }
}

export const outboxEventService = new OutboxEventService(new OutboxEventRepository());
