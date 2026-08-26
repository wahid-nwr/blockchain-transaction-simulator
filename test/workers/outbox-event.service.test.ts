import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OutboxEventService } from '../../src/services/outbox-event.service.js';

vi.mock('../../src/queues/outbox-relay.queue.js', () => ({
    outboxRelayQueue: {
        addBulk: vi.fn().mockResolvedValue([]),
    },
}));

vi.mock('../../src/observability/logger.js', () => ({
    getLogger: () => ({
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
    }),
}));

import { outboxRelayQueue } from '../../src/queues/outbox-relay.queue.js';

describe('OutboxEventService', () => {
    const repository = {
        createInTransaction: vi.fn(),
        claimUnpublished: vi.fn(),
        markPublished: vi.fn(),
    } as any;

    let service: OutboxEventService;

    beforeEach(() => {
        vi.clearAllMocks();
        service = new OutboxEventService(repository);
    });

    describe('relay()', () => {
        it('returns 0 and does not touch the queue when there are no unpublished events', async () => {
            repository.claimUnpublished.mockResolvedValue([]);

            const count = await service.relay();

            expect(count).toBe(0);
            expect(outboxRelayQueue.addBulk).not.toHaveBeenCalled();
            expect(repository.markPublished).not.toHaveBeenCalled();
        });

        it('enqueues events BEFORE marking published (so a crash between the two is safe)', async () => {
            const events = [
                {
                    id: 'evt-1',
                    type: 'transaction.confirmed',
                    aggregateId: 'tx-1',
                    payload: { txHash: '0xabc' },
                },
                {
                    id: 'evt-2',
                    type: 'transaction.confirmed',
                    aggregateId: 'tx-2',
                    payload: { txHash: '0xdef' },
                },
            ];

            repository.claimUnpublished.mockResolvedValue(events);

            const callOrder: string[] = [];

            vi.mocked(outboxRelayQueue.addBulk).mockImplementation(async () => {
                callOrder.push('enqueue');
                return [];
            });

            repository.markPublished.mockImplementation(async () => {
                callOrder.push('mark');
            });

            await service.relay();

            expect(callOrder).toEqual(['enqueue', 'mark']);
        });

        it('uses the outbox event ID as the BullMQ job ID to make re-enqueueing idempotent', async () => {
            const events = [
                { id: 'evt-1', type: 'tx.confirmed', aggregateId: 'tx-1', payload: {} },
            ];

            repository.claimUnpublished.mockResolvedValue(events);
            repository.markPublished.mockResolvedValue(undefined);

            await service.relay();

            const jobs = vi.mocked(outboxRelayQueue.addBulk).mock.calls[0][0];
            expect(jobs[0].opts?.jobId).toBe('evt-1');
        });

        it('enqueues all claimed events and marks exactly their IDs as published', async () => {
            const events = [
                { id: 'evt-1', type: 'tx.confirmed', aggregateId: 'tx-1', payload: { a: 1 } },
                { id: 'evt-2', type: 'tx.confirmed', aggregateId: 'tx-2', payload: { b: 2 } },
            ];

            repository.claimUnpublished.mockResolvedValue(events);
            repository.markPublished.mockResolvedValue(undefined);

            const count = await service.relay();

            expect(count).toBe(2);
            expect(repository.markPublished).toHaveBeenCalledWith(['evt-1', 'evt-2']);
        });

        it('respects the limit parameter passed to claimUnpublished', async () => {
            repository.claimUnpublished.mockResolvedValue([]);

            await service.relay(10);

            expect(repository.claimUnpublished).toHaveBeenCalledWith(10);
        });
    });
});
