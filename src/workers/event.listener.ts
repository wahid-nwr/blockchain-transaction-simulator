import 'dotenv/config';

import { createPublicClient, http, parseAbiItem } from 'viem';
import { TransferEventService } from '../services/transfer-event.service.js';
import { prisma } from '../database/prisma.js';
import { TokenEventCursorRepository } from '../repositories/token-event-cursor.repository.js';
import { getLogger } from '../observability/index.js';
import { eventListenerEventsProcessedTotal } from '../metrics/event-listener.metrics.js';

const client = createPublicClient({
    transport: http(process.env.RPC_URL, {
        retryCount: 0,
    }),
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
