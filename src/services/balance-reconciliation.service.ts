import type { Blockchain } from '@prisma/client';

import { BalanceRepository } from '../repositories/balance.repository.js';
import { Errors } from '../common/errors/errors.js';
import { blockchainForChainId } from '../blockchain/wallet-address.js';
import type { BlockchainAdapterRegistry } from '../blockchain/blockchain-adapter.registry.js';

export type BalanceReconciliationStatus = 'MATCH' | 'MISMATCH' | 'STALE_OBSERVATION';

export interface BalanceReconciliationRequest {
    walletId: string;
    walletAddress: string;
    walletChainId: number;
    tokenId: string;
    blockchain: Blockchain;
    /** Chain-specific asset identifier; absent means the native asset. */
    assetIdentifier?: string;
    /** Chain observation position (block / height / slot); absent = latest. */
    blockNumber?: bigint;
}

export interface BalanceReconciliationResult {
    status: BalanceReconciliationStatus;
    blockchain: Blockchain;
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

/**
 * Read-only comparison of a persisted BalanceSnapshot against the chain.
 *
 * Chain-agnostic: it never touches a chain client. The chain is resolved
 * from the token's `blockchain` through the adapter registry, and the
 * adapter's optional `getTokenBalance` capability does the read. The
 * comparison relies only on `blockNumber` being a monotonic position, so
 * it holds unchanged for EVM blocks, Bitcoin heights and Solana slots.
 */
export class BalanceReconciliationService {
    constructor(
        private readonly repository: BalanceRepository,
        private readonly blockchainRegistry: BlockchainAdapterRegistry,
    ) {}

    async reconcile(request: BalanceReconciliationRequest): Promise<BalanceReconciliationResult> {
        const { walletId, tokenId, blockchain } = request;

        // A wallet's address means nothing on another chain: reading it
        // through this token's adapter would query the wrong ledger (or
        // fail with a confusing chain-specific error). Reject up front.
        if (blockchainForChainId(request.walletChainId) !== blockchain) {
            throw Errors.walletTokenChainMismatch(request.walletChainId, blockchain);
        }

        const adapter = this.blockchainRegistry.get(blockchain);

        if (!adapter.getTokenBalance) {
            throw Errors.unsupportedChainCapability('balance reconciliation', blockchain);
        }

        const persisted = await this.repository.find(walletId, tokenId);

        const chain = await adapter.getTokenBalance({
            walletAddress: request.walletAddress,
            assetIdentifier: request.assetIdentifier,
            blockNumber: request.blockNumber,
        });

        if (!persisted) {
            return { status: 'MISMATCH', blockchain, walletId, tokenId, persisted: null, chain };
        }

        const persistedView = {
            balance: persisted.balance,
            blockNumber: persisted.blockNumber,
        };

        if (chain.blockNumber < persisted.blockNumber) {
            return {
                status: 'STALE_OBSERVATION',
                blockchain,
                walletId,
                tokenId,
                persisted: persistedView,
                chain,
            };
        }

        return {
            status: persisted.balance === chain.balance ? 'MATCH' : 'MISMATCH',
            blockchain,
            walletId,
            tokenId,
            persisted: persistedView,
            chain,
        };
    }
}
