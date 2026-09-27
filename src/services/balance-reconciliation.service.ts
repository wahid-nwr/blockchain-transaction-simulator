import { BalanceRepository } from '../repositories/balance.repository.js';
import type { TokenBalanceReader } from '../blockchain/token-balance-reader.js';

export type BalanceReconciliationStatus = 'MATCH' | 'MISMATCH' | 'STALE_OBSERVATION';

export interface BalanceReconciliationResult {
    status: BalanceReconciliationStatus;
    walletId: string;
    tokenId: string;
    persisted: {
        balance: bigint;
        blockNumber: bigint;
    } | null;
    chain: {
        balance: bigint;
        blockNumber: bigint;
    };
}

export class BalanceReconciliationService {
    constructor(
        private readonly repository: BalanceRepository,
        private readonly balanceReader: TokenBalanceReader,
    ) {}

    async reconcile(
        walletId: string,
        walletAddress: string,
        tokenId: string,
        tokenAddress: string,
        blockNumber: bigint,
    ): Promise<BalanceReconciliationResult> {
        const persisted = await this.repository.find(walletId, tokenId);

        const chain = await this.balanceReader.getTokenBalance({
            walletAddress,
            tokenAddress,
            blockNumber,
        });

        if (!persisted) {
            return {
                status: 'MISMATCH',
                walletId,
                tokenId,
                persisted: null,
                chain,
            };
        }

        if (chain.blockNumber < persisted.blockNumber) {
            return {
                status: 'STALE_OBSERVATION',
                walletId,
                tokenId,
                persisted: {
                    balance: persisted.balance,
                    blockNumber: persisted.blockNumber,
                },
                chain,
            };
        }

        return {
            status: persisted.balance === chain.balance ? 'MATCH' : 'MISMATCH',
            walletId,
            tokenId,
            persisted: {
                balance: persisted.balance,
                blockNumber: persisted.blockNumber,
            },
            chain,
        };
    }
}
