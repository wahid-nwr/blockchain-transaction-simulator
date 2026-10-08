import 'dotenv/config';

import { createPublicClient, http, parseAbiItem } from 'viem';
import { Blockchain } from '@prisma/client';
import { TransferEventService } from '../services/transfer-event.service.js';
import { prisma } from '../database/prisma.js';
import { TokenEventCursorRepository } from '../repositories/token-event-cursor.repository.js';
import { getLogger } from '../observability/index.js';
import {
    eventListenerEventsProcessedTotal,
    eventListenerLagBlocks,
} from '../metrics/event-listener.metrics.js';
import { loadEvmIndexerConfig } from '../blockchain/evm/indexer-config.js';
import { scanLogWindows } from '../blockchain/evm/log-windows.js';

const client = createPublicClient({
    transport: http(process.env.RPC_URL, {
        retryCount: 0,
    }),
    // Disable viem's block-number cache (default ~4s). Without this, a stale
    // cached value can outlive a chain reset (e.g. anvil_reset in tests, or
    // any RPC endpoint swap/rollback in general) and get used as `toBlock`
    // in getLogs, causing BlockOutOfRangeError when the real chain height
    // is lower than the cached number.
    cacheTime: 0,
});

const transferEvent = parseAbiItem(
    'event Transfer(address indexed from, address indexed to, uint256 value)',
);

const processingTokens = new Set<string>();

// A fresh cursor with no EVM_INDEX_START_BLOCK scans from genesis. That is
// right on a local node and a long, expensive crawl on a real chain, so past
// this many blocks it is worth telling the operator.
const LONG_CATCH_UP_WARNING_BLOCKS = 100_000n;

// Largest window the RPC has accepted so far in this process. Once a provider
// has rejected a size, asking for it again every cycle would just repeat the
// failed request, so a learned limit sticks until restart.
let learnedMaxBlockRange: bigint | undefined;

/** Test hook: forget any block-range limit learned from the RPC. */
export function resetEvmIndexerState() {
    learnedMaxBlockRange = undefined;
}

export async function processTokenEvents(databaseTokenId: string) {
    if (processingTokens.has(databaseTokenId)) {
        return;
    }

    processingTokens.add(databaseTokenId);

    const cursorRepo = new TokenEventCursorRepository();
    let cursorLoaded = false;

    try {
        const token = await prisma.token.findUnique({
            where: {
                id: databaseTokenId,
            },
        });

        if (!token) {
            throw new Error(`Token ${databaseTokenId} not found`);
        }

        // Bitcoin and Solana have no Transfer-log (or equivalent)
        // analogue to index — neither has a token/contract layer in this
        // system today, only native-asset transfers submitted directly
        // through TransferService. Calling getLogs against a non-EVM
        // contractAddress would throw or behave unpredictably, so this
        // skips cleanly instead of assuming every Token row is EVM. See
        // ADR-012.
        if (token.blockchain !== Blockchain.EVM) {
            getLogger().info(
                { databaseTokenId, blockchain: token.blockchain },
                'Skipping event indexing: not supported for this chain',
            );
            return;
        }

        const config = loadEvmIndexerConfig();

        const cursor = await cursorRepo.getOrCreate(databaseTokenId);
        cursorLoaded = true;

        const currentBlock = await client.getBlockNumber();

        // Only index blocks that are `confirmations` deep, so a shallow
        // reorg near the head cannot leave transfers from an orphaned block
        // in the database (there is no rollback). 0 keeps the old behaviour.
        const indexableHead = currentBlock - config.confirmations;

        const freshCursor = cursor.lastProcessedBlock === 0n;

        const fromBlock = freshCursor ? config.startBlock : cursor.lastProcessedBlock - 1n;

        if (fromBlock > indexableHead) {
            getLogger().info(
                {
                    databaseTokenId,
                    currentBlock,
                    lastProcessedBlock: cursor.lastProcessedBlock,
                },
                'No new blocks to process',
            );

            setLag(databaseTokenId, currentBlock, cursor.lastProcessedBlock);
            return;
        }

        if (freshCursor && config.startBlock > currentBlock) {
            // Wrong network's block number pasted in, most likely: with the
            // start block ahead of the head nothing is ever indexed.
            getLogger().warn(
                {
                    databaseTokenId,
                    startBlock: config.startBlock.toString(),
                    currentBlock: currentBlock.toString(),
                },
                'EVM_INDEX_START_BLOCK is ahead of the chain head; nothing will be indexed until the chain reaches it',
            );
        }

        if (
            freshCursor &&
            config.startBlock === 0n &&
            indexableHead - fromBlock > LONG_CATCH_UP_WARNING_BLOCKS
        ) {
            getLogger().warn(
                {
                    databaseTokenId,
                    currentBlock: currentBlock.toString(),
                },
                'Indexing a new token from block 0 on a long chain. Set EVM_INDEX_START_BLOCK to the ' +
                    "contract's deployment block to skip the empty history",
            );
        }

        const service = new TransferEventService();

        const result = await scanLogWindows({
            from: fromBlock,
            to: indexableHead,
            maxRange: learnedMaxBlockRange ?? config.maxBlockRange,
            maxWindows: config.maxWindowsPerRun,

            fetch: (from, to) =>
                client.getLogs({
                    address: token.contractAddress as `0x${string}`,
                    event: transferEvent,
                    fromBlock: from,
                    toBlock: to,
                }),

            // Each window is persisted on its own, so a long catch-up keeps
            // its progress if a later window (or the process) fails.
            onWindow: async (logs, range) => {
                getLogger().debug(
                    {
                        databaseTokenId,
                        fromBlock: range.from.toString(),
                        toBlock: range.to.toString(),
                        logCount: logs.length,
                        logs: logs.map((log) => ({
                            blockNumber: log.blockNumber.toString(),
                            transactionHash: log.transactionHash,
                            logIndex: Number(log.logIndex),
                        })),
                    },
                    'Token transfer logs fetched',
                );

                for (const log of logs) {
                    await service.handleTransferEvent({
                        tokenAddress: log.address,
                        from: log.args.from!,
                        to: log.args.to!,
                        amount: log.args.value!,
                        transactionHash: log.transactionHash,
                        logIndex: Number(log.logIndex),
                        blockNumber: log.blockNumber,
                    });
                }

                await cursorRepo.markSuccess(token.id, range.to);
                eventListenerEventsProcessedTotal.inc(logs.length);
            },

            onShrink: (newRange, error) => {
                learnedMaxBlockRange = newRange;

                getLogger().warn(
                    {
                        databaseTokenId,
                        blockRange: newRange.toString(),
                        error: error instanceof Error ? error.message : String(error),
                    },
                    'RPC rejected the eth_getLogs block range; using a smaller range. ' +
                        'Set EVM_LOGS_MAX_BLOCK_RANGE to this value to skip the retry on restart',
                );
            },
        });

        setLag(databaseTokenId, currentBlock, result.lastProcessed ?? cursor.lastProcessedBlock);

        if (result.complete) {
            getLogger().debug(
                {
                    databaseTokenId,
                    fromBlock: fromBlock.toString(),
                    toBlock: indexableHead.toString(),
                    windows: result.windows,
                },
                'Token events indexed up to head',
            );
        } else {
            getLogger().info(
                {
                    databaseTokenId,
                    indexedThrough: result.lastProcessed?.toString(),
                    head: indexableHead.toString(),
                    windows: result.windows,
                },
                'Indexer still catching up; continuing next cycle',
            );
        }
    } catch (error) {
        getLogger().error(
            {
                databaseTokenId,
                error,
            },
            'Event processing error thrown',
        );

        // Best effort: record the failure on the cursor (failureCount /
        // lastFailedSync already exist for this). Never let bookkeeping mask
        // the real error.
        if (cursorLoaded) {
            await cursorRepo.markFailure(databaseTokenId).catch(() => undefined);
        }

        throw error;
    } finally {
        processingTokens.delete(databaseTokenId);
    }
}

function setLag(databaseTokenId: string, head: bigint, lastIndexed: bigint) {
    // Clamped: after a chain reset the cursor can sit ahead of the head.
    const lag = head > lastIndexed ? head - lastIndexed : 0n;

    eventListenerLagBlocks.set({ token_id: databaseTokenId }, Number(lag));
}

export const start = processTokenEvents;
