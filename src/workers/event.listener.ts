import "dotenv/config";
import {
    createPublicClient,
    http,
    parseAbiItem
} from "viem";
import { TransferEventService } from "../services/transfer-event.service.js";

const client = createPublicClient({
    transport: http(process.env.RPC_URL)
});

const transferEvent = parseAbiItem(
    "event Transfer(address indexed from, address indexed to, uint256 value)"
);

async function start() {
    console.log(
        "Starting blockchain listener..."
    );

    const logs = await client.getLogs({
        address: process.env.TOKEN_ADDRESS! as `0x${string}`,
        event: transferEvent,
        fromBlock: 0n
    });

    console.log(
        `Found ${logs.length} Transfer events`
    );

    const service = new TransferEventService();

    for (const log of logs) {
        console.log({
            from: log.args.from,
            to: log.args.to,
            value: log.args.value
        });

        await service.handleTransferEvent({
            tokenAddress: log.address,
            from: log.args.from!,
            to: log.args.to!,
            amount: log.args.value!,
            transactionHash: log.transactionHash,
            blockNumber: log.blockNumber!
        });
    }
}

start();