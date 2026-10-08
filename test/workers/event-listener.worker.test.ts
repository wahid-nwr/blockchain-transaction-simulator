import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventListenerWorker, backoffDelay } from '../../src/workers/event-listener.worker.js';
import { prisma } from '../../src/database/prisma.js';
import { processTokenEvents } from '../../src/workers/event.listener.js';
import {
    eventListenerCyclesTotal,
    eventListenerFailuresTotal,
    eventListenerDuration,
} from '../../src/metrics/event-listener.metrics.js';

vi.mock('../../src/workers/event.listener.js', () => ({
    processTokenEvents: vi.fn(),
}));

vi.mock('../../src/database/prisma.js', () => ({
    prisma: {
        token: {
            findMany: vi.fn(),
        },
    },
}));

describe('EventListenerWorker', () => {
    let worker: EventListenerWorker;

    beforeEach(() => {
        vi.clearAllMocks();

        worker = new EventListenerWorker();
    });

    it('should process all registered tokens', async () => {
        vi.mocked(prisma.token.findMany).mockResolvedValue([
            {
                id: 'token-1',
            },
            {
                id: 'token-2',
            },
        ] as any);

        vi.mocked(processTokenEvents).mockResolvedValue(undefined);

        await worker.processCycle();

        expect(processTokenEvents).toHaveBeenCalledTimes(2);

        expect(processTokenEvents).toHaveBeenCalledWith('token-1');

        expect(processTokenEvents).toHaveBeenCalledWith('token-2');
    });

    it('should not allow worker to start twice', async () => {
        const startPromise = worker.start(10);

        await expect(worker.start(10)).rejects.toThrow('Event listener worker already running');

        worker.stop();

        await startPromise;
    });

    it('should stop worker loop', async () => {
        const promise = worker.start(10);

        expect(worker.isRunning()).toBe(true);

        worker.stop();

        await promise;

        expect(worker.isRunning()).toBe(false);
    });

    it('should continue processing other tokens when one token fails', async () => {
        vi.mocked(prisma.token.findMany).mockResolvedValue([
            {
                id: 'token-1',
            },
            {
                id: 'token-2',
            },
        ] as any);

        vi.mocked(processTokenEvents)
            .mockRejectedValueOnce(new Error('RPC failed'))
            .mockResolvedValueOnce(undefined);

        await worker.processCycle();

        expect(processTokenEvents).toHaveBeenCalledTimes(2);

        expect(processTokenEvents).toHaveBeenNthCalledWith(1, 'token-1');

        expect(processTokenEvents).toHaveBeenNthCalledWith(2, 'token-2');
    });

    it('should record event listener cycle metric', async () => {
        const cycleSpy = vi.spyOn(eventListenerCyclesTotal, 'inc');

        vi.spyOn(prisma.token, 'findMany').mockResolvedValue([]);

        await worker.processCycle();

        expect(cycleSpy).toHaveBeenCalledTimes(1);
    });

    it('should record event listener failure metric when processing fails', async () => {
        const failureSpy = vi.spyOn(eventListenerFailuresTotal, 'inc');

        vi.mocked(prisma.token.findMany).mockResolvedValue([
            {
                id: 'token-1',
            },
        ] as any);

        vi.mocked(processTokenEvents).mockRejectedValue(new Error('RPC failed'));

        await worker.processCycle();

        expect(failureSpy).toHaveBeenCalledTimes(1);
    });

    it('should record event listener duration metric', async () => {
        const timerSpy = vi.spyOn(eventListenerDuration, 'startTimer');

        vi.spyOn(prisma.token, 'findMany').mockResolvedValue([]);

        await worker.processCycle();

        expect(timerSpy).toHaveBeenCalledTimes(1);
    });

    it('reports how many tokens failed in a cycle', async () => {
        vi.mocked(prisma.token.findMany).mockResolvedValue([
            { id: 'token-1' },
            { id: 'token-2' },
            { id: 'token-3' },
        ] as any);

        vi.mocked(processTokenEvents)
            .mockRejectedValueOnce(new Error('RPC failed'))
            .mockResolvedValueOnce(undefined)
            .mockRejectedValueOnce(new Error('RPC failed'));

        await expect(worker.processCycle()).resolves.toEqual({ failedTokens: 2 });
    });

    it('reports zero failures for a clean cycle', async () => {
        vi.mocked(prisma.token.findMany).mockResolvedValue([{ id: 'token-1' }] as any);
        vi.mocked(processTokenEvents).mockResolvedValue(undefined);

        await expect(worker.processCycle()).resolves.toEqual({ failedTokens: 0 });
    });
});

describe('backoffDelay', () => {
    it('keeps the normal interval while cycles succeed', () => {
        expect(backoffDelay(5000, 0)).toBe(5000);
    });

    it('doubles with each consecutive failure', () => {
        expect(backoffDelay(5000, 1)).toBe(10_000);
        expect(backoffDelay(5000, 2)).toBe(20_000);
        expect(backoffDelay(5000, 3)).toBe(40_000);
    });

    it('caps at one minute so a long outage is still retried', () => {
        expect(backoffDelay(5000, 4)).toBe(60_000);
        expect(backoffDelay(5000, 50)).toBe(60_000);
    });

    it('never goes below a base interval that is itself above the cap', () => {
        expect(backoffDelay(120_000, 3)).toBe(120_000);
    });
});
