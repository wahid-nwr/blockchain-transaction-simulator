# ADR 013: Chain-Agnostic Balance Reconciliation

## Status

Accepted

## Date

2026-09-28

# Context

`BalanceReconciliationService` compared a persisted `BalanceSnapshot` with an
on-chain balance, but it was wired to `EvmTokenBalanceReader` at the route
level, took an EVM-shaped `tokenAddress`, and required an EVM `blockNumber`.
Nothing about the comparison itself is EVM-specific, yet adding a second
chain would have meant a second route, a second service, or branching
inside this one.

# Decision

## 1. Balance reads become an optional adapter capability

`BlockchainAdapter` gains `getTokenBalance?(request)`, alongside the
existing optional `mint?`. Callers check `if (adapter.getTokenBalance)` and
raise `UNSUPPORTED_CHAIN_CAPABILITY` otherwise, rather than each chain
needing a throwing stub (same reasoning as ADR-012 §2). `EvmAdapter`
implements it; Bitcoin and Solana do not yet.

## 2. The request and result are chain-neutral

`TokenBalanceRequest.tokenAddress` becomes `assetIdentifier?` (matching
`TransferRequest` and `MintRequest`); absent means the chain's native
asset. `blockNumber` stays the field name (no migration, no API break) but
is documented as the chain's **monotonic observation position**: EVM block
number, Bitcoin height, Solana slot. The reconciliation logic only relies on
"larger means later", which holds for all of them, so `STALE_OBSERVATION`
detection is unchanged.

## 3. The service resolves the chain; it does not own one

`BalanceReconciliationService` takes the `BlockchainAdapterRegistry` and
resolves the adapter from `token.blockchain`. `reconcile` takes a request
object instead of five positional strings.

## 4. A wallet must be on the token's chain

`Wallet` is keyed by numeric `chainId`, `Token` by the `Blockchain` enum
(ADR-012 §"Fix `Wallet.chainId` vs. `Token.blockchain`" deferred merging
them). Reconciliation is the first place that pairs the two for a chain
read, so `blockchainForChainId` bridges them in `wallet-address.ts` and a
mismatch (or unrecognized chainId) fails with `WALLET_TOKEN_CHAIN_MISMATCH`
before any read. This does not merge the two models.

## 5. `blockNumber` is optional on the endpoint

Omitted means "latest"; the response's `chain.blockNumber` reports the
position the adapter actually observed. The response also now includes
`blockchain`.

# Consequences

## Positive

- Adding a chain's reconciliation is one adapter method; no service or
  route change.
- Comparing a wallet on one chain against a token on another can no longer
  reach an RPC call.

## Negative

- Bitcoin and Solana adapters have no `getTokenBalance` yet. No token can be
  registered on those chains today (`validateAssetIdentifier` returns
  `false`, ADR-012), so this is unreachable rather than broken, but it is
  the first thing to add when native-asset tokens are supported.
- `BalanceSyncService` still defaults to `EvmTokenBalanceReader` and its
  caller (`TransferEventService`) is EVM-only. It shares the renamed
  `TokenBalanceRequest` but was not made registry-driven.
- `MISMATCH` still cannot distinguish indexer lag from real drift when the
  chain position is ahead of the snapshot; unchanged from before.

# Alternatives Considered

## A reader interface per chain, injected at the route

Keeps the registry out of the service, but repeats the chain-to-reader
mapping the registry already owns and leaves the route to pick.

## Rename `blockNumber` to `observedAt`/`position` across API and DB

More accurate, but a migration and a breaking API change for a naming
gain; documenting the meaning was enough.

# Future Improvements

- `getTokenBalance` for Bitcoin (address UTXO sum) and Solana (native and
  SPL) when those chains get a token layer.
- Make `BalanceSyncService` registry-driven and retire
  `EvmTokenBalanceReader`, which `EvmAdapter.getTokenBalance` now duplicates.
- The scheduled reconciliation job from the roadmap, built on this service.
