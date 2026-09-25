import 'dotenv/config';

import { createPublicClient, http, parseAbiItem } from 'viem';
import { Blockchain } from '@prisma/client';
import { TransferEventService } from '../services/transfer-event.service.js';
import { prisma } from '../database/prisma.js';
import { TokenEventCursorRepository } from '../repositories/token-event-cursor.repository.js';
import { getLogger } from '../observability/index.js';
import { eventListenerEventsProcessedTotal } from '../metrics/event-listener.metrics.js';

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

export async function processTokenEvents(databaseTokenId: string) {
    if (processingTokens.has(databaseTokenId)) {
        return;
    }

    processingTokens.add(databaseTokenId);

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

        const cursorRepo = new TokenEventCursorRepository();
        const cursor = await cursorRepo.getOrCreate(databaseTokenId);

        const currentBlock = await client.getBlockNumber();

        const fromBlock = cursor.lastProcessedBlock > 0n ? cursor.lastProcessedBlock - 1n : 0n;

        if (fromBlock > currentBlock) {
            getLogger().info(
                {
                    databaseTokenId,
                    currentBlock,
                    lastProcessedBlock: cursor.lastProcessedBlock,
                },
                'No new blocks to process',
            );
            return;
        }

        getLogger().info(
            {
                fromBlock,
                currentBlock,
            },
            'Processing blocks:',
        );

        const logs = await client.getLogs({
            address: token.contractAddress as `0x${string}`,
            event: transferEvent,
            fromBlock,
            toBlock: currentBlock,
        });
        getLogger().info(
            {
                databaseTokenId,
                fromBlock: fromBlock.toString(),
                currentBlock: currentBlock.toString(),
                logCount: logs.length,
                logs: logs.map((log) => ({
                    blockNumber: log.blockNumber.toString(),
                    transactionHash: log.transactionHash,
                    logIndex: Number(log.logIndex),
                })),
            },
            'Token transfer logs fetched',
        );

        const service = new TransferEventService();

        try {
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

            await cursorRepo.markSuccess(token.id, currentBlock);
            eventListenerEventsProcessedTotal.inc(logs.length);
        } catch (error) {
            getLogger().error(
                {
                    databaseTokenId,
                    error,
                },
                'Event processing error thrown',
            );

            throw error;
        }
    } catch (error) {
        getLogger().error(
            {
                databaseTokenId,
                error,
            },
            'Event processing error thrown',
        );

        throw error;
    } finally {
        processingTokens.delete(databaseTokenId);
    }
}

export const start = processTokenEvents;
