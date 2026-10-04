/**
 * Numeric `chainId` values the platform stores on a Wallet.
 *
 * Kept in their own module (and re-exported from wallet-address.ts, where
 * they historically lived) so both wallet-address.ts and evm/chain.ts can
 * depend on them without importing each other.
 */

/** Default EVM chain: a local Anvil/Hardhat node. Overridable via EVM_CHAIN_ID. */
export const ANVIL_CHAIN_ID = 31337;

export const BITCOIN_REGTEST_CHAIN_ID = 18444;

// Unlike ANVIL_CHAIN_ID (a real EVM chain ID) or BITCOIN_REGTEST_CHAIN_ID
// (which at least corresponds to Bitcoin regtest's actual default P2P
// port), Solana has no chain-ID concept at all (see ADR-011) — this value
// is an arbitrary sentinel, not derived from anything Solana-specific.
export const SOLANA_LOCALNET_CHAIN_ID = 900;
