import "dotenv/config";
import { createPublicClient, http, parseAbiItem } from "viem";
import { prisma } from "../database/prisma.js";
import { TransferRepository } from "../repositories/transfer.repository.js";

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
        fromBlock:0n
    });

    const transferRepository = new TransferRepository();
    for (const log of logs) {
        console.log({
            from: log.args.from,
            to: log.args.to,
            value: log.args.value
        });

        const token = await prisma.token.findUnique({
            where: {
                contractAddress: process.env.TOKEN_ADDRESS!
            }
        });

        if (!token) {
            throw new Error("Token not registered");
        }

        await transferRepository.create({
            tokenId: token.id,
            from: log.args.from!,
            to: log.args.to!,
            amount: log.args.value!,
            transactionHash: log.transactionHash,
            blockNumber: log.blockNumber!
        });
    }
}
start();