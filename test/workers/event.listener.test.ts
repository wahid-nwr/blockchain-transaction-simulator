import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getLogsMock, handleTransferEventMock } = vi.hoisted(() => ({
    getLogsMock: vi.fn(),
    handleTransferEventMock: vi.fn(),
}));

vi.mock('viem', () => ({
    createPublicClient: vi.fn(() => ({
        getLogs: getLogsMock,
    })),
    http: vi.fn(() => 'mock-http'),

    parseAbiItem: vi.fn(() => 'mock-event'),
}));

vi.mock('../../src/services/transfer-event.service.js', () => ({
    TransferEventService: vi.fn(() => ({
        handleTransferEvent: handleTransferEventMock,
    })),
}));

import { start } from '../../src/workers/event.listener.js';

describe('Event Listener', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        process.env.RPC_URL = 'http://localhost:8545';
        process.env.TOKEN_ADDRESS = '0xtoken';
    });

    it('should process Transfer events', async () => {
        getLogsMock.mockResolvedValue([
            {
                address: '0xtoken',
                args: {
                    from: '0xfrom',
                    to: '0xto',
                    value: 1000n,
                },
                transactionHash: '0xtxhash',
                blockNumber: 10n,
            },
        ]);
        await start();

        expect(handleTransferEventMock).toHaveBeenCalledWith({
            tokenAddress: '0xtoken',
            from: '0xfrom',
            to: '0xto',
            amount: 1000n,
            transactionHash: '0xtxhash',
            blockNumber: 10n,
        });
    });

    it('should handle empty event list', async () => {
        getLogsMock.mockResolvedValue([]);

        await start();

        expect(handleTransferEventMock).not.toHaveBeenCalled();
    });

    it('should propagate RPC failure', async () => {
        getLogsMock.mockRejectedValue(new Error('RPC unavailable'));

        await expect(start()).rejects.toThrow('RPC unavailable');
    });
});
