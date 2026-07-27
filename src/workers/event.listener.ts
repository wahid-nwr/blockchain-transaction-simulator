import 'dotenv/config';

import { createPublicClient, http, parseAbiItem } from 'viem';
import { TransferEventService } from '../services/transfer-event.service.js';
import { prisma } from '../database/prisma.js';
import { TokenEventCursorRepository } from '../repositories/token-event-cursor.repository.js';
import { getLogger } from '../observability/index.js';
import { eventListenerEventsProcessedTotal } from '../metrics/event-listener.metrics.js';

const client = createPublicClient({
    transport: http(process.env.RPC_URL),
});

const transferEvent = parseAbiItem(
    'event Transfer(address indexed from, address indexed to, uint256 value)',
);

export async function processTokenEvents(databaseTokenId: string) {
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
                lastProcessedBlock: token.lastProcessedBlock,
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

        const processedBlock =
            logs.length > 0
                ? logs.reduce((max, log) => (log.blockNumber > max ? log.blockNumber : max), 0n)
                : currentBlock;

        await cursorRepo.markSuccess(token.id, processedBlock);
        eventListenerEventsProcessedTotal.inc(logs.length);
    } catch (error) {
        getLogger().error({error}, 'Event processing error thrown:');

        throw error;
    }
}

export const start = processTokenEvents;
