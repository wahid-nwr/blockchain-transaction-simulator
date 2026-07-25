import { describe, it, expect, vi, beforeEach } from 'vitest';

const startMock = vi.fn();

const stopMock = vi.fn();

vi.mock('../../src/workers/event-listener.worker.js', () => {
    return {
        EventListenerWorker: vi.fn().mockImplementation(() => ({
            start: startMock,
            stop: stopMock,
        })),
    };
});

describe('Event listener runner', () => {
    beforeEach(() => {
        vi.clearAllMocks();

        process.removeAllListeners('SIGTERM');

        process.removeAllListeners('SIGINT');
    });

    it('should start worker', async () => {
        startMock.mockResolvedValue(undefined);

        const { startEventListenerWorker } =
            await import('../../src/workers/event-listener.runner.js');

        await startEventListenerWorker();

        expect(startMock).toHaveBeenCalledTimes(1);
    });

    it('should stop worker on SIGTERM', async () => {
        startMock.mockResolvedValue(undefined);

        const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

        const { startEventListenerWorker } =
            await import('../../src/workers/event-listener.runner.js');

        await startEventListenerWorker();

        process.emit('SIGTERM');

        await Promise.resolve();

        expect(stopMock).toHaveBeenCalled();

        expect(exitSpy).toHaveBeenCalledWith(0);

        exitSpy.mockRestore();
    });
});
