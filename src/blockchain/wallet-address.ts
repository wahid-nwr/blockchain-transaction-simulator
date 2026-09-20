import { isAddress as isEvmAddress } from 'viem';
import { PublicKey } from '@solana/web3.js';

export const ANVIL_CHAIN_ID = 31337;
export const BITCOIN_REGTEST_CHAIN_ID = 18444;
// Unlike ANVIL_CHAIN_ID (a real EVM chain ID) or BITCOIN_REGTEST_CHAIN_ID
// (which at least corresponds to Bitcoin regtest's actual default P2P
// port), Solana has no chain-ID concept at all (see ADR-011) — this value
// is an arbitrary sentinel, not derived from anything Solana-specific.
export const SOLANA_LOCALNET_CHAIN_ID = 900;

export function isCaseInsensitiveWalletAddress(chainId: number, address: string): boolean {
    if (chainId === ANVIL_CHAIN_ID) {
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
    switch (chainId) {
        case ANVIL_CHAIN_ID:
            return isEvmAddress(address);

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
