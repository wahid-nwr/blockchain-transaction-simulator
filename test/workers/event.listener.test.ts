import { describe, it, expect, vi, beforeEach } from 'vitest';
import { start } from '../../src/workers/event.listener.js';

const { getLogsMock, getBlockNumberMock, handleTransferEventMock } = vi.hoisted(() => ({
    getLogsMock: vi.fn(),
    getBlockNumberMock: vi.fn(),
    handleTransferEventMock: vi.fn(),
}));

const { findUniqueMock } = vi.hoisted(() => ({
    findUniqueMock: vi.fn(),
}));

vi.mock('../../src/database/prisma.js', () => ({
    prisma: {
        token: {
            findUnique: findUniqueMock,
            update: vi.fn(),
        },
    },
}));

vi.mock('viem', () => ({
    createPublicClient: vi.fn(() => ({
        getLogs: getLogsMock,
        getBlockNumber: getBlockNumberMock,
    })),
    http: vi.fn(() => 'mock-http'),
    parseAbiItem: vi.fn(() => 'mock-event'),
}));

vi.mock('../../src/services/transfer-event.service.js', () => ({
    TransferEventService: vi.fn(() => ({
        handleTransferEvent: handleTransferEventMock,
    })),
}));

describe('Event Listener', () => {
    let tokenId: string;
    getBlockNumberMock.mockResolvedValue(10n);
    beforeEach(async () => {
        vi.clearAllMocks();

        process.env.RPC_URL = 'http://localhost:8545';

        tokenId = 'b0fa2611-5426-44d5-83d1-3e8e7c6e8f7a';
        findUniqueMock.mockResolvedValue({
            id: tokenId,
            name: 'Test Token',
            symbol: 'TEST',
            contractAddress: '0xtoken',
            decimals: 6,
            lastProcessedBlock: 0n,
        });
    });

    it('should process Transfer events', async () => {
        getLogsMock.mockResolvedValue([
            {
                id: tokenId,
                address: '0xtoken',
                args: {
                    from: '0xfrom',
                    to: '0xto',
                    value: 1000n,
                },
                transactionHash: '0xtxhash',
                blockNumber: 10n,
                logIndex: 0n,
            },
        ]);
        await start(tokenId);

        expect(handleTransferEventMock).toHaveBeenCalledWith({
            tokenAddress: '0xtoken',
            from: '0xfrom',
            to: '0xto',
            amount: 1000n,
            transactionHash: '0xtxhash',
            logIndex: 0,
            blockNumber: 10n,
        });
    });

    it('should handle empty event list', async () => {
        getLogsMock.mockResolvedValue([]);

        await start(tokenId);

        expect(handleTransferEventMock).not.toHaveBeenCalled();
    });

    it('should propagate RPC failure', async () => {
        getLogsMock.mockRejectedValue(new Error('RPC unavailable'));

        await expect(start(tokenId)).rejects.toThrow('RPC unavailable');
    });
});
