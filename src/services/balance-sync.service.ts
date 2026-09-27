import { BalanceRepository } from '../repositories/balance.repository.js';
import { getLogger } from '../observability/index.js';
import { EvmTokenBalanceReader } from '../blockchain/evm/evm-token-balance-reader.js';
import type { TokenBalanceReader } from '../blockchain/token-balance-reader.js';

export class BalanceSyncService {
    constructor(
        private readonly repository = new BalanceRepository(),
        private readonly balanceReader: TokenBalanceReader = new EvmTokenBalanceReader(),
    ) {}

    async sync(
        walletId: string,
        walletAddress: string,
        tokenId: string,
        tokenAddress: string,
        blockNumber: bigint,
    ) {
        getLogger().info(
            {
                walletId,
                walletAddress,
                tokenAddress,
                tokenId,
                blockNumber,
            },
            'Syncing wallet token balance',
        );

        const result = await this.balanceReader.getTokenBalance({
            walletAddress,
            tokenAddress,
            blockNumber,
        });

        return this.repository.upsert({
            walletId,
            tokenId,
            balance: result.balance,
            blockNumber: result.blockNumber,
        });
    }
}
