# ADR 009: Blockchain Adapter Pattern for Multi-Chain Support (Bitcoin)

## Status

Accepted

## Date

2026-09-12

---

# Context

The platform was originally built against a single blockchain: an Ethereum-compatible network, accessed through viem, with a hardcoded ERC20 contract (`MiniUSDT`). `TransferService` and `ConfirmationProcessor` called viem clients directly. There was no notion of "which chain" a token or a transaction belonged to, because there was only ever one answer.

Adding Bitcoin support meant introducing a second chain with a genuinely different transaction model:

* Account-based (nonce, gas, contract calls) vs. UTXO-based (no nonce, no gas, no contracts)
* A signed-transaction-per-custodial-wallet model (EVM) vs. a node-operated wallet model (Bitcoin Core's own wallet)
* JSON-RPC 2.0 over `eth_*` methods vs. JSON-RPC 1.0 over Bitcoin Core's own method names
* Receipt-based confirmation that throws for an unmined transaction (EVM) vs. a raw-transaction lookup that returns successfully with zero confirmations (Bitcoin)

The question was how to add this without either (a) hardcoding `if (chain === 'BITCOIN')` branches through `TransferService`, `ConfirmationProcessor`, and every other caller that currently assumes EVM, or (b) rewriting those callers around a Bitcoin-shaped interface that would fit poorly if a third, EVM-like chain were added next.

---

# Decision

Introduce a `BlockchainAdapter` interface (`src/blockchain/blockchain-adapter.ts`) with exactly the two operations every caller actually needs — `submitTransfer` and `getTransaction` — and a `BlockchainAdapterRegistry` that resolves an adapter by chain name. `TransferService` and `ConfirmationProcessor` depend only on the registry and the interface; neither imports viem or the Bitcoin RPC client.

Chain selection is driven by data, not by the caller. A `Blockchain` enum (`EVM` | `BITCOIN`) was added to `Token` (migration `20260912131829_add_blockchain_to_token`), defaulting existing rows to `EVM`. `TransferService.transfer` and `ConfirmationProcessor.confirmTransaction` both resolve the adapter from `token.blockchain`, so the same transfer/confirmation code path runs for both chains without a conditional.

## A deliberately thin shared interface

`TransferRequest`/`BlockchainTransaction` are shared shapes with a few fields that are meaningful for one chain family and unused/null for the other (`assetIdentifier`, `gasUsed`). The alternative — chain-specific request/response types with a discriminated union — was considered and rejected for this first pass: it would have pushed a `switch` on chain type into every caller, which is exactly what the adapter pattern is meant to avoid. A shared shape with some chain-specific fields left optional was judged the smaller cost, on the assumption (revisit if a third, sufficiently different chain is added) that two chains' worth of "mostly overlapping, a few unused fields" is more maintainable than a union type threaded through every call site.

## Bitcoin got a hand-written RPC client, not a library

EVM integration uses viem, a full-featured client library, because EVM interaction genuinely needs a lot: ABI encoding, typed contract calls, nonce management, receipt polling. Bitcoin integration needs exactly two RPC methods (`sendtoaddress`, `getrawtransaction`). A full Bitcoin library (many of which also bundle wallet/key-management code the application doesn't want, since custody is delegated to Bitcoin Core) was judged unnecessary complexity for what `BitcoinRpcClient` actually needs to do — a ~50-line hand-rolled JSON-RPC 1.0 client, mirroring the shape of the EVM RPC error handling.

## Bitcoin custody was scoped to "delegate to the node," not "build per-wallet keys"

The EVM adapter signs with per-custodial-wallet keys via `SignerService`. Building the Bitcoin equivalent — per-wallet descriptors or PSBT-based signing coordinated by the application — was explicitly out of scope for this pass. `BitcoinAdapter.submitTransfer` instead sends every transfer from one Bitcoin Core wallet (`BITCOIN_RPC_WALLET`), ignoring `request.walletId`. This was accepted as a starting point specifically to prove out the adapter pattern end-to-end (submission, confirmation polling, E2E coverage) without also taking on Bitcoin key-management design in the same change. It is called out as a gap in `docs/blockchain-integration.md` rather than left undocumented, and is expected to be revisited before the adapter is used for non-trivial value.

## Confirmation semantics were not unified across chains

`success` in `BlockchainTransaction` means "the receipt/lookup indicates this transaction is done and not reverted" — but *how* that's determined differs by chain, and that difference was not smoothed over. EVM's `getTransactionReceipt` throws for an unmined transaction, so an EVM `success: false` can only mean "actually reverted." Bitcoin's `getrawtransaction` returns successfully for an unconfirmed (mempool) transaction, so `confirmations > 0` was used as the success signal, and an unconfirmed Bitcoin transaction consequently also reports `success: false` — indistinguishable, from the caller's point of view, from a chain that has genuinely failed. `ConfirmationProcessor` was not changed to special-case this. This is a known, documented gap (see `docs/blockchain-integration.md`), not an oversight discovered after the fact — it was accepted for this pass on the reasoning that shipping the adapter pattern and Bitcoin submission/confirmation end-to-end was more valuable to land first than blocking on a tri-state confirmation result across both adapters.

> **Resolved in [ADR-010](010-tri-state-confirmation-status.md).** `success: boolean | null` was replaced with `status: 'pending' | 'confirmed' | 'failed'`, and `ConfirmationProcessor` now retries on `'pending'` instead of treating it as a revert. That work also surfaced and fixed a second, previously-undetected bug: `BitcoinAdapter` read a `blockheight` field from `getrawtransaction` that Bitcoin Core's RPC does not actually return, so a genuinely confirmed Bitcoin transaction had `blockNumber: null` and got stuck retrying `persistConfirmation`'s "no block number" guard indefinitely once `claimConfirmation` had already committed it to `CONFIRMING`. See ADR-010 for both fixes.

---

# Consequences

## Positive

### Adding Bitcoin touched zero EVM code paths

`EvmAdapter`, `evm/evm.adapter.ts`, and every EVM-specific test were untouched by this change. The only shared files modified were the interface itself, the registry, and the two call sites (`TransferService`, `ConfirmationProcessor`), both of which changed from "call viem directly" to "call `blockchainRegistry.get(chain)`" — a small, mechanical change.

### Chain becomes a data property, not a code branch

`Token.blockchain` is queried like any other column. Nothing needed to change in the transfer/confirmation API surface, request DTOs, or routing to support a second chain — a token simply declares which chain it's on.

### The registry generalizes to a third chain

Adding a third chain (another EVM-compatible network, or another UTXO chain) is, by design, "implement `BlockchainAdapter`, register it" — the same shape of change Bitcoin required. Whether the interface itself scales cleanly to a *very* different chain (e.g. one with multi-step transaction construction, like a chain requiring PSBT-style assembly for every transfer) is untested by this ADR and should be revisited when/if that happens.

## Negative

### The shared interface already has chain-specific dead fields

`gasUsed` is always `null` for Bitcoin; `assetIdentifier` is unused by the Bitcoin adapter. This is a small, currently-tolerable amount of interface impurity, but it's the first sign of the union-type trade-off discussed above, and a third sufficiently different chain would make it worse rather than better.

### Two real gaps were shipped, and were only mitigated by documentation, not code

The unconfirmed-vs-failed confirmation ambiguity and the shared-node-wallet custody model were both accepted-for-now trade-offs, not solved problems, at the time this ADR was written. **The confirmation ambiguity is now fixed** (see the Resolved note above and [ADR-010](010-tri-state-confirmation-status.md)) — nothing in `ConfirmationProcessor` marked a still-pending Bitcoin transfer `FAILED` anymore once ADR-010 landed. **The shared-node-wallet custody model remains an open, deliberate trade-off** — see ADR-010's custody decision, which chose to keep it for now rather than build per-wallet Bitcoin custody.

### No chain-tagged observability yet

EVM RPC calls are instrumented (`rpc.instrumentation.ts`); Bitcoin RPC calls are not. Debugging a stuck Bitcoin confirmation today means reading application logs and reasoning about `BitcoinRpcClient` directly, rather than pivoting from a `chain="BITCOIN"` metric or span the way an EVM RPC problem can be triaged.

### Local development doesn't have Bitcoin by default

`docker-compose.yml` was not updated to include a Bitcoin regtest service — only `docker-compose.e2e.yml` was. A developer iterating on Bitcoin behavior outside of the E2E suite has to stand up a node themselves.

---

# Alternatives Considered

## Chain-specific request/response types with a discriminated union

Rejected for this pass (see "A deliberately thin shared interface" above) in favor of a shared shape with a few unused fields per chain. Revisit if a third chain makes the shared shape awkward enough that callers start needing to branch on chain type anyway — at that point the union approach would no longer be worse than the status quo.

## Build Bitcoin custody as per-wallet descriptors/PSBTs from the start

Rejected as too large to land in the same change as the adapter pattern itself. The shared-node-wallet approach was chosen so the adapter pattern, submission flow, and confirmation flow could all be proven out and E2E-tested first, with custody isolation treated as a fast-follow (see `docs/blockchain-integration.md`'s Future Improvements).

## Use a full Bitcoin client library instead of a hand-written RPC client

Rejected because the application's actual Bitcoin RPC surface is two methods; a full library would add a dependency (and often bundled key-management code that duplicates/competes with Bitcoin Core's own wallet, which this design deliberately delegates to) for capability the application doesn't use.

## Make `ConfirmationProcessor` chain-aware for the success/pending distinction, in this same change

Rejected for this pass. Fixing it properly means deciding on a shared "pending vs. terminal" signal across both adapters (a tri-state result, or a chain-specific pending check) and updating `ConfirmationProcessor`'s branching accordingly — a real design decision, not a drive-by fix. Landing the adapter pattern and Bitcoin support with the gap documented was judged better than blocking on it. Tracked as a Future Improvement in `docs/blockchain-integration.md`.

---

# Future Improvements

* ~~Give `BitcoinAdapter.getTransaction` (or `ConfirmationProcessor`) a real "pending" signal distinct from "failed," closing the gap described above.~~ **Done — see [ADR-010](010-tri-state-confirmation-status.md).**
* Per-wallet Bitcoin custody (descriptors or PSBT-based signing), replacing the single shared `BITCOIN_RPC_WALLET`. **Revisited and explicitly deferred again in ADR-010**, ahead of the Solana adapter.
* Chain-tagged RPC instrumentation and metrics for Bitcoin, matching what EVM already has.
* A Bitcoin regtest service in `docker-compose.yml`, not only `docker-compose.e2e.yml`, so local Bitcoin development doesn't require a manual container.
* Revisit the shared `TransferRequest`/`BlockchainTransaction` shape if/when a third, sufficiently different chain is added. **In progress — see ADR-010, written ahead of the Solana adapter.**