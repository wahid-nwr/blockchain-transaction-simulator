import type { Blockchain } from '@prisma/client';

/**
 * Whether a `Token.contractAddress` for this blockchain is safe to
 * case-fold. Deliberately separate from `wallet-address.ts`'s
 * `isCaseInsensitiveWalletAddress` — a `Token` is keyed by the
 * `Blockchain` enum, a `Wallet` by numeric `chainId`, and the two are not
 * merged here (see ADR-012's Future Improvements).
 *
 * Today only EVM ever reaches this as `true` in practice:
 * `BlockchainAdapter.validateAssetIdentifier` rejects any Bitcoin or
 * Solana registration before `TokenRepository` is called at all (neither
 * chain has a token/contract layer in this system yet). This is still
 * written chain-aware, rather than left as a blanket lowercase, so it
 * doesn't silently corrupt the first real non-EVM identifier the moment
 * that changes — the same mistake ADR-011 found and fixed for wallet
 * addresses.
 */
export function isCaseInsensitiveAssetIdentifier(blockchain: Blockchain): boolean {
    // EVM hex addresses: case is a cosmetic EIP-55 checksum, not part of
    // the address's identity.
    return blockchain === 'EVM';
}

export function normalizeContractAddress(blockchain: Blockchain, contractAddress: string): string {
    return isCaseInsensitiveAssetIdentifier(blockchain)
        ? contractAddress.toLowerCase()
        : contractAddress;
}
