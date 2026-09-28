import { erc20Abi } from 'viem';
import { publicClient } from '../client.js';
import type {
    TokenBalanceReader,
    TokenBalanceRequest,
    TokenBalance,
} from '../token-balance-reader.js';

export class EvmTokenBalanceReader implements TokenBalanceReader {
    async getTokenBalance(request: TokenBalanceRequest): Promise<TokenBalance> {
        if (request.blockNumber === undefined) {
            throw new Error('EVM token balance requires a block number');
        }

        if (!request.assetIdentifier) {
            throw new Error('EVM token balance requires an asset contract address');
        }

        const balance = await publicClient.readContract({
            address: request.assetIdentifier as `0x${string}`,
            abi: erc20Abi,
            functionName: 'balanceOf',
            args: [request.walletAddress as `0x${string}`],
            blockNumber: request.blockNumber,
        });

        return {
            balance: balance as bigint,
            blockNumber: request.blockNumber,
        };
    }
}
