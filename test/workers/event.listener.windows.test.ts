import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { randomUUID } from 'crypto';
import { prisma } from '../../src/database/prisma.js';
import { resetEvmIndexerState, start } from '../../src/workers/event.listener.js';
import { register } from '../../src/metrics/registry.js';

const { getLogsMock, getBlockNumberMock, handleTransferEventMock } = vi.hoisted(() => ({
    getLogsMock: vi.fn(),
    getBlockNumberMock: vi.fn(),
    handleTransferEventMock: vi.fn(),
}));

vi.mock('../../src/database/prisma.js', () => ({
    prisma: {
        token: { findUnique: vi.fn() },
        tokenEventCursor: { upsert: vi.fn(), update: vi.fn() },
    },
}));

vi.mock('viem', () => ({
    createPublicClient: vi.fn(() => ({ getLogs: getLogsMock, getBlockNumber: getBlockNumberMock })),
    http: vi.fn(() => 'mock-http'),
    parseAbiItem: vi.fn(() => 'mock-event'),
}));

vi.mock('../../src/services/transfer-event.service.js', () => ({
    TransferEventService: vi.fn(() => ({ handleTransferEvent: handleTransferEventMock })),
}));

const TOKEN_ID = randomUUID();

function cursorAt(lastProcessedBlock: bigint) {
    vi.mocked(prisma.tokenEventCursor.upsert).mockResolvedValue({
        tokenId: TOKEN_ID,
        lastProcessedBlock,
    } as never);
}

const getLogsRanges = () =>
    getLogsMock.mock.calls.map(([args]) => [args.fromBlock, args.toBlock] as [bigint, bigint]);

const markedBlocks = () =>
    vi
        .mocked(prisma.tokenEventCursor.update)
        .mock.calls.map(
            ([args]) => (args as { data: { lastProcessedBlock?: bigint } }).data.lastProcessedBlock,
        );

const rpcRangeError = () =>
    Object.assign(new Error('The request failed.'), {
        cause: new Error('query returned more than 10000 results'),
    });

describe('Event listener: bounded windows against a real-chain RPC', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        getLogsMock.mockReset();
        getBlockNumberMock.mockReset();
        resetEvmIndexerState();

        vi.mocked(prisma.token.findUnique).mockResolvedValue({
            id: TOKEN_ID,
            contractAddress: '0xtoken',
            blockchain: 'EVM',
        } as never);

        getLogsMock.mockResolvedValue([]);
    });

    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('indexes a long gap in bounded windows instead of one huge getLogs', async () => {
        vi.stubEnv('EVM_LOGS_MAX_BLOCK_RANGE', '1000');
        cursorAt(0n);
        getBlockNumberMock.mockResolvedValue(2499n);

        await start(TOKEN_ID);

        expect(getLogsRanges()).toEqual([
            [0n, 999n],
            [1000n, 1999n],
            [2000n, 2499n],
        ]);
    });

    it('persists the cursor after every window, so catch-up progress survives a failure', async () => {
        vi.stubEnv('EVM_LOGS_MAX_BLOCK_RANGE', '1000');
        cursorAt(0n);
        getBlockNumberMock.mockResolvedValue(2499n);

        await start(TOKEN_ID);

        expect(markedBlocks()).toEqual([999n, 1999n, 2499n]);
    });

    it('keeps the cursor at the last good window when a later window fails', async () => {
        vi.stubEnv('EVM_LOGS_MAX_BLOCK_RANGE', '1000');
        cursorAt(0n);
        getBlockNumberMock.mockResolvedValue(2499n);
        getLogsMock.mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('connection reset'));

        await expect(start(TOKEN_ID)).rejects.toThrow('connection reset');

        expect(markedBlocks().filter((b) => b !== undefined)).toEqual([999n]);
    });

    it('records the failure on the cursor', async () => {
        cursorAt(0n);
        getBlockNumberMock.mockResolvedValue(10n);
        getLogsMock.mockRejectedValue(new Error('RPC unavailable'));

        await expect(start(TOKEN_ID)).rejects.toThrow('RPC unavailable');

        expect(prisma.tokenEventCursor.update).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({ failureCount: { increment: 1 } }),
            }),
        );
    });

    it('starts a never-indexed token at EVM_INDEX_START_BLOCK, not genesis', async () => {
        vi.stubEnv('EVM_INDEX_START_BLOCK', '1000000');
        cursorAt(0n);
        getBlockNumberMock.mockResolvedValue(1000500n);

        await start(TOKEN_ID);

        expect(getLogsRanges()).toEqual([[1000000n, 1000500n]]);
    });

    it('does nothing, without throwing, when EVM_INDEX_START_BLOCK is ahead of the head', async () => {
        vi.stubEnv('EVM_INDEX_START_BLOCK', '5000000');
        cursorAt(0n);
        getBlockNumberMock.mockResolvedValue(100n);

        await expect(start(TOKEN_ID)).resolves.toBeUndefined();

        expect(getLogsMock).not.toHaveBeenCalled();
    });

    it('ignores EVM_INDEX_START_BLOCK once a token has a cursor, resuming one block back', async () => {
        vi.stubEnv('EVM_INDEX_START_BLOCK', '1000000');
        cursorAt(1000300n);
        getBlockNumberMock.mockResolvedValue(1000500n);

        await start(TOKEN_ID);

        expect(getLogsRanges()).toEqual([[1000299n, 1000500n]]);
    });

    it('only indexes blocks that are EVM_INDEX_CONFIRMATIONS deep', async () => {
        vi.stubEnv('EVM_INDEX_CONFIRMATIONS', '20');
        cursorAt(0n);
        getBlockNumberMock.mockResolvedValue(100n);

        await start(TOKEN_ID);

        expect(getLogsRanges()).toEqual([[0n, 80n]]);
        expect(markedBlocks()).toEqual([80n]);
    });

    it('does nothing while the chain is shorter than the confirmation depth', async () => {
        vi.stubEnv('EVM_INDEX_CONFIRMATIONS', '20');
        cursorAt(0n);
        getBlockNumberMock.mockResolvedValue(5n);

        await start(TOKEN_ID);

        expect(getLogsMock).not.toHaveBeenCalled();
    });

    it('shrinks the window when the RPC rejects the range, and remembers the limit', async () => {
        vi.stubEnv('EVM_LOGS_MAX_BLOCK_RANGE', '8000');
        cursorAt(0n);
        getBlockNumberMock.mockResolvedValue(7999n);
        getLogsMock.mockImplementation(
            async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) => {
                if (toBlock - fromBlock + 1n > 2000n) {
                    throw rpcRangeError();
                }
                return [];
            },
        );

        await start(TOKEN_ID);

        // 8000 -> 4000 -> 2000, then four accepted windows.
        expect(getLogsRanges()).toEqual([
            [0n, 7999n],
            [0n, 3999n],
            [0n, 1999n],
            [2000n, 3999n],
            [4000n, 5999n],
            [6000n, 7999n],
        ]);

        // The next cycle starts at the learned size, so the rejected size is not retried.
        getLogsMock.mockClear();
        cursorAt(7999n);
        getBlockNumberMock.mockResolvedValue(11999n);

        await start(TOKEN_ID);

        expect(getLogsRanges()[0]).toEqual([7998n, 9997n]);
    });

    it('does not shrink the window on a rate-limit error', async () => {
        cursorAt(0n);
        getBlockNumberMock.mockResolvedValue(5000n);
        getLogsMock.mockRejectedValue(
            Object.assign(new Error('HTTP request failed.'), {
                cause: Object.assign(new Error('Too Many Requests'), { status: 429 }),
            }),
        );

        await expect(start(TOKEN_ID)).rejects.toThrow();

        expect(getLogsMock).toHaveBeenCalledTimes(1);
    });

    it('bounds the work per cycle and resumes where it stopped', async () => {
        vi.stubEnv('EVM_LOGS_MAX_BLOCK_RANGE', '1000');
        vi.stubEnv('EVM_INDEX_MAX_WINDOWS_PER_RUN', '2');
        cursorAt(0n);
        getBlockNumberMock.mockResolvedValue(9999n);

        await start(TOKEN_ID);

        expect(getLogsRanges()).toEqual([
            [0n, 999n],
            [1000n, 1999n],
        ]);
        expect(markedBlocks()).toEqual([999n, 1999n]);

        // Next cycle: cursor is at 1999, resumes one block back.
        getLogsMock.mockClear();
        cursorAt(1999n);

        await start(TOKEN_ID);

        expect(getLogsRanges()[0]).toEqual([1998n, 2997n]);
    });

    it("feeds every window's logs to the event service", async () => {
        vi.stubEnv('EVM_LOGS_MAX_BLOCK_RANGE', '10');
        cursorAt(0n);
        getBlockNumberMock.mockResolvedValue(19n);
        const log = (blockNumber: bigint) => ({
            address: '0xtoken',
            args: { from: '0xa', to: '0xb', value: 1n },
            transactionHash: `0xtx${blockNumber}`,
            blockNumber,
            logIndex: 0n,
        });
        getLogsMock.mockResolvedValueOnce([log(3n)]).mockResolvedValueOnce([log(14n), log(15n)]);

        await start(TOKEN_ID);

        expect(handleTransferEventMock).toHaveBeenCalledTimes(3);
        expect(handleTransferEventMock.mock.calls.map(([e]) => e.blockNumber)).toEqual([
            3n,
            14n,
            15n,
        ]);
    });

    it('reports indexing lag as head minus the last indexed block', async () => {
        vi.stubEnv('EVM_INDEX_CONFIRMATIONS', '20');
        cursorAt(0n);
        getBlockNumberMock.mockResolvedValue(100n);

        await start(TOKEN_ID);

        const metrics = await register.getSingleMetricAsString('event_listener_lag_blocks');

        // head 100, indexed through 80 (confirmation depth 20).
        expect(metrics).toContain(`event_listener_lag_blocks{token_id="${TOKEN_ID}"} 20`);
    });

    it('fails fast on a malformed indexer setting rather than scanning the wrong range', async () => {
        vi.stubEnv('EVM_LOGS_MAX_BLOCK_RANGE', 'lots');
        cursorAt(0n);

        await expect(start(TOKEN_ID)).rejects.toThrow(/Invalid EVM_LOGS_MAX_BLOCK_RANGE/);

        expect(getLogsMock).not.toHaveBeenCalled();
    });
});
