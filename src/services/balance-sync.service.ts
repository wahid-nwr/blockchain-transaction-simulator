import { publicClient } from "../blockchain/client.js";
import { BalanceRepository } from "../repositories/balance.repository.js";
import { erc20Abi } from "viem";
import { logger } from "../utils/logger.js";

export class BalanceSyncService {

    constructor(
        private readonly repository = new BalanceRepository()
    ) {}

    async sync(
        walletId: string,
        walletAddress: string,
        tokenId: string,
        tokenAddress: string,
        blockNumber: bigint
    ) {
        logger.info(
            {
                walletId,
                walletAddress,
                tokenAddress,
                tokenId,
                blockNumber
            },
            "Syncing wallet token balance"
        );
        const balance = await publicClient.readContract({
            address: tokenAddress as `0x${string}`,
            abi: erc20Abi,
            functionName: "balanceOf",
            args:[
                walletAddress as `0x${string}`
            ]
        });

        return this.repository.upsert({
            walletId,
            tokenId,
            balance: balance as bigint,
            blockNumber
        });
    }
}