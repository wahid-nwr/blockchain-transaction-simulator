# ADR-013: Native balance reconciliation for Bitcoin and Solana

- **Status:** Accepted
- **Date:** 2026-09-28
- **Scope:** Balance reconciliation and native-asset representation

## Context

`BalanceReconciliationService` already compares a persisted `BalanceSnapshot` with a chain observation through the optional `BlockchainAdapter.getTokenBalance` capability. The observation position is chain-neutral: an EVM block number, Bitcoin block height, or Solana slot.

Bitcoin and Solana transfers are native-asset operations in this platform. They do not have an ERC-20-style contract identifier. The existing `Token` model already permits `contractAddress = null`, so the same row can represent a native BTC or SOL asset for balance snapshots and reconciliation.

## Decision

Implement native balance reads directly on the Bitcoin and Solana adapters rather than adding chain-specific reconciliation services.

### Bitcoin

`BitcoinAdapter.getTokenBalance`:

1. Rejects an `assetIdentifier`; only native BTC is supported.
2. Reads the current Bitcoin Core chain height with `getblockchaininfo`.
3. Reads confirmed UTXOs for the requested wallet address with wallet-scoped `listunspent` and `minconf=1`.
4. Sums UTXO amounts into satoshis using integer arithmetic after normalizing Bitcoin Core's 8-decimal BTC representation.
5. Returns the current chain height as the observation position.
6. Rejects a requested observation height above the current chain tip.

Historical address balances at an arbitrary Bitcoin height are intentionally not implemented. Reconstructing them would require historical UTXO-set/index support that the current adapter does not have.

### Solana

`SolanaAdapter.getTokenBalance`:

1. Rejects an `assetIdentifier`; only native SOL is supported.
2. Reads the balance with `Connection.getBalanceAndContext` at `confirmed` commitment.
3. Uses the RPC response context slot as the observation position.
4. When a requested slot is supplied, passes it as `minContextSlot` so the returned observation is not older than the requested position.
5. Returns lamports as the integer balance.

The Solana SDK explicitly exposes `getBalanceAndContext` with a slot-bearing RPC context and supports `minContextSlot` in balance query configuration. urlSolana web3.js Connection APIhttps://solana-foundation.github.io/solana-web3.js/classes/Connection.html

### Native token representation

`TokenService` now permits Bitcoin and Solana registrations without `contractAddress`. EVM registration still requires and validates an asset contract address. A native BTC/SOL token therefore has `contractAddress = null` and remains compatible with the existing `BalanceSnapshot(walletId, tokenId)` projection.

Only one native asset row per blockchain is treated as the logical native asset by the repository's duplicate check.

## Consequences

- The reconciliation service remains chain-agnostic.
- The HTTP reconciliation endpoint works for EVM, Bitcoin, and Solana without chain-specific route logic.
- Persisted snapshots remain read-only during reconciliation; a mismatch is reported, not silently repaired.
- Bitcoin reconciliation is explicitly a current-tip observation, not arbitrary historical-state reconstruction.
- Solana reconciliation can honor a minimum requested slot but may return a newer slot as the actual observation.
- SPL tokens and Bitcoin token-like protocols remain outside this scope; they require separate asset/indexing designs.

## Verification

Coverage added for:

- Bitcoin native balance conversion and chain-height handling.
- Solana native balance/context-slot handling and `minContextSlot`.
- Chain-agnostic reconciliation dispatch for Bitcoin and Solana.
- Native Bitcoin registration without a contract address.
- HTTP E2E reconciliation against the real Bitcoin Core regtest and Solana test validator.
