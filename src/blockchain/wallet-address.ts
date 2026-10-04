import { isAddress as isEvmAddress } from 'viem';
import { PublicKey } from '@solana/web3.js';
import type { Blockchain } from '@prisma/client';
import { ANVIL_CHAIN_ID, BITCOIN_REGTEST_CHAIN_ID, SOLANA_LOCALNET_CHAIN_ID } from './chain-ids.js';
import { isEvmChainId } from './evm/chain.js';

// Re-exported so existing imports from this module keep working.
export { ANVIL_CHAIN_ID, BITCOIN_REGTEST_CHAIN_ID, SOLANA_LOCALNET_CHAIN_ID };

/**
 * The `Blockchain` a wallet's numeric `chainId` belongs to, or `undefined`
 * for an unrecognized chainId. A Wallet is keyed by `chainId` and a Token
 * by the `Blockchain` enum (see token-identifier.ts); this is the one place
 * the two are bridged, so code that pairs a wallet with a token can check
 * they live on the same chain before reading either from the chain.
 */
export function blockchainForChainId(chainId: number): Blockchain | undefined {
    // The EVM chain is configurable (EVM_CHAIN_ID); only that one chain ID
    // maps to EVM, so a deployment never accepts wallets for an EVM chain
    // it has no node for.
    if (isEvmChainId(chainId)) {
        return 'EVM';
    }

    switch (chainId) {
        case BITCOIN_REGTEST_CHAIN_ID:
            return 'BITCOIN';
        case SOLANA_LOCALNET_CHAIN_ID:
            return 'SOLANA';
        default:
            return undefined;
    }
}

export function isCaseInsensitiveWalletAddress(chainId: number, address: string): boolean {
    if (isEvmChainId(chainId)) {
        // EVM hex addresses: case is a cosmetic EIP-55 checksum, not part
        // of the address's identity.
        return true;
    }

    if (chainId === BITCOIN_REGTEST_CHAIN_ID) {
        // bech32 (bcrt1...) is conventionally lowercase and safe to
        // case-fold. Legacy base58 (m/n/2-prefixed) is case-sensitive —
        // lowercasing it silently produces a different, wrong address.
        // A single chainId covers both encodings for Bitcoin regtest, so
        // this has to inspect the address itself rather than the chainId
        // alone.
        return /^bcrt1/i.test(address);
    }

    // SOLANA_LOCALNET_CHAIN_ID (base58) and anything unrecognized:
    // case-sensitive by default. Getting this wrong the other way
    // (treating a case-sensitive address as case-insensitive) silently
    // corrupts or collides addresses; getting it wrong this way
    // (treating a case-insensitive one as case-sensitive) merely allows
    // a harmless case-variant duplicate through. See ADR-011 — this was
    // a real, pre-existing bug for Bitcoin's own legacy addresses,
    // caught only once Solana's addresses (always case-sensitive) made
    // it impossible to ignore.
    return false;
}

export function normalizeWalletAddress(chainId: number, address: string): string {
    return isCaseInsensitiveWalletAddress(chainId, address) ? address.toLowerCase() : address;
}

export function isValidWalletAddress(chainId: number, address: string): boolean {
    if (isEvmChainId(chainId)) {
        return isEvmAddress(address);
    }

    switch (chainId) {
        case BITCOIN_REGTEST_CHAIN_ID:
            return isBitcoinRegtestAddress(address);

        case SOLANA_LOCALNET_CHAIN_ID:
            return isSolanaAddress(address);

        default:
            return false;
    }
}

function isBitcoinRegtestAddress(address: string): boolean {
    if (!address) {
        return false;
    }

    return (
        /^bcrt1[ac-hj-np-z02-9]{8,87}$/i.test(address) ||
        /^[mn2][1-9A-HJ-NP-Za-km-z]{25,39}$/.test(address)
    );
}

function isSolanaAddress(address: string): boolean {
    if (!address) {
        return false;
    }

    // A Solana address is a base58-encoded Ed25519 public key — exactly
    // 32 bytes. Constructing a PublicKey both base58-decodes and checks
    // the byte length; anything else throws, which is the standard way
    // to validate one (there is no separate regex/checksum format the
    // way Bitcoin or EVM addresses have).
    try {
        return PublicKey.isOnCurve(new PublicKey(address));
    } catch {
        return false;
    }
}
