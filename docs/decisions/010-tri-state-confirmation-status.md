# ADR 010: Tri-State Confirmation Status, Bitcoin Custody Revisited, and Scoping a Third Chain

## Status

Accepted

## Date

2026-09-19

---

# Context

[ADR-009](009-blockchain-adapter-pattern.md) shipped the `BlockchainAdapter` abstraction and the Bitcoin adapter, and explicitly documented two trade-offs rather than solving them: a `success: boolean | null` field that conflated "still pending" with "genuinely failed" for Bitcoin, and a single shared Bitcoin Core wallet standing in for per-wallet custody.

This ADR was written as Phase 0 of adding a third chain, Solana, specifically *because* Solana's transaction-finality model (commitment levels: `processed` / `confirmed` / `finalized`, plus blockhash-expiry instead of a nonce) would have made the existing binary `success` field even more likely to misreport "not yet final" as "failed" than Bitcoin's mempool case did. The plan was: fix the known gap properly, make a deliberate custody decision instead of defaulting into one again, and scope what a third, differently-shaped chain actually needs from the interface — all before writing a line of Solana code.

## A second bug surfaced while fixing the first

While replacing `success` with a tri-state result, testing the Bitcoin path end-to-end (letting a transaction actually reach a mined, confirmed state instead of being cut off at "pending") surfaced a second, previously-undetected bug: `BitcoinAdapter.getTransaction` read `transaction.blockheight` from `getrawtransaction`'s response, but Bitcoin Core's `getrawtransaction` RPC does not return a `blockheight` field at all — only `blockhash`, `confirmations`, and `blocktime` (verified against Bitcoin Core's own RPC docs for v22 through v31; `blockheight` exists only on the wallet-scoped `gettransaction` RPC, which this adapter deliberately doesn't call — see ADR-009's custody discussion for why). Every genuinely confirmed Bitcoin transaction therefore had `blockNumber: null`, which failed `ConfirmationProcessor`'s `persistConfirmation` guard ("Confirmed transaction ... has no block number") on every single poll — and because `claimConfirmation` had already committed the transaction to `CONFIRMING` before that guard ran, the transaction was stuck there permanently, retried forever, never reaching `CONFIRMED` or any other terminal state.

This bug predated this ADR (it was present in the original Bitcoin adapter from ADR-009) and was masked by the *first* bug: a Bitcoin transaction was previously being marked `FAILED` while still unconfirmed, so it rarely lived long enough in the confirmation loop to reach a genuinely-confirmed poll and hit the missing-block-number guard. Fixing the first bug in isolation would have simply traded "wrongly marked FAILED immediately" for "stuck in CONFIRMING forever" — a worse outcome, since `FAILED` is at least a terminal state a human or the expiration sweep can act on, while `CONFIRMING`-forever is not caught by `ExpirationProcessor` (that processor is designed to catch transactions stuck in "not yet confirmed" states like `SUBMITTED`, not ones that have already been claimed into `CONFIRMING`). Both bugs are fixed together in this ADR.

---

# Decision

## 1. `BlockchainTransaction.success: boolean | null` → `status: 'pending' | 'confirmed' | 'failed'`

`src/blockchain/blockchain-adapter.ts` now defines:

```typescript
export type ConfirmationStatus = 'pending' | 'confirmed' | 'failed';

export interface BlockchainTransaction {
    txHash: string;
    blockNumber: bigint | null;
    confirmations: number;
    status: ConfirmationStatus;
    gasUsed: bigint | null;
}
```

- **EVM** (`EvmAdapter.getTransaction`): unchanged in spirit. `getTransactionReceipt` still throws for an unmined transaction (handled the same way as before — see point 3 below), so every receipt this method actually returns is terminal: `status: receipt.status === 'success' ? 'confirmed' : 'failed'`. EVM never produces `'pending'` from this method.
- **Bitcoin** (`BitcoinAdapter.getTransaction`): `status: confirmations > 0 ? 'confirmed' : 'pending'`. A `'failed'` status isn't reachable from this method today — Bitcoin has no on-chain revert once confirmed, and a transaction that never confirms and drops from the mempool instead surfaces as an RPC "not found" error (see point 3).

`ConfirmationProcessor.processTransaction` now switches on `status`: `'confirmed'` → `handleSuccessfulTransaction`, `'failed'` → `handleRevertedTransaction`, `'pending'` → throw a new `TransactionPendingError` (`src/common/errors/transaction-pending.error.ts`).

## 2. `TransactionPendingError` reuses the existing "not found yet" retry path, not a new one

Rather than inventing a second retry mechanism, `TransactionPendingError` is caught by `ConfirmationProcessor.handleConfirmationError` alongside the existing "could not be found" check (previously EVM-only) and rethrown without incrementing the `CONFIRMATION_ERROR` failure metric — the same treatment viem's `TransactionReceiptNotFoundError` already got. BullMQ's normal job attempts/backoff (`src/queues/transaction.queue.ts`) take it from there, and `ExpirationProcessor` remains the eventual backstop if a transaction never leaves `pending`/`SUBMITTED`. No new retry infrastructure was built; the existing one was made chain-agnostic.

While in `handleConfirmationError`, Bitcoin Core's own "not found" RPC error message (`"No such mempool or blockchain transaction..."`) was also added to the retryable-error match. It doesn't share EVM's `"could not be found"` substring, so before this change a Bitcoin transaction not yet visible to the node at all (as opposed to visible-but-pending) was incorrectly incrementing the genuine-failure metric on every ordinary poll. This is a small, related fix bundled into the same change since it's the same category of bug (an EVM-shaped check silently not covering Bitcoin's error strings).

## 3. Bitcoin block height: resolved via `getblockheader`, not read from `getrawtransaction`

`BitcoinAdapter.getTransaction` now calls `getblockheader(blockhash)` for its `height` field when (and only when) `confirmations > 0` and a `blockhash` is present, instead of reading a `blockheight` field that doesn't exist on `getrawtransaction`'s response. This keeps the common case (a still-pending poll) to a single RPC call, and adds a second call only once a transaction is actually confirmed and its block number is needed.

## 4. Bitcoin custody: shared node wallet is kept, deliberately, for now

ADR-009 defaulted into shared-node-wallet custody as a side effect of scoping Bitcoin support narrowly. Revisiting it here as a real decision rather than letting the same default carry forward into Solana: **the shared-node-wallet model is kept for Bitcoin**, on the following reasoning —

- Building per-wallet Bitcoin custody (descriptors or PSBT-based signing) is a substantial, standalone piece of work — comparable in scope to the entire Bitcoin adapter itself — and bundling it into this ADR would block the confirmation-status fix (which was the actually urgent, actively-misbehaving bug) behind unrelated design work.
- No production Bitcoin funds are custodied by this platform yet (per ADR-009's own security note, this gap was flagged specifically as something to resolve "before the adapter is used for non-trivial value"). There is no active blast-radius risk being carried forward silently.
- Solana's custody question is independent of Bitcoin's — an app-held keypair per wallet is the natural default for Solana (there is no Bitcoin-Core-wallet-style external custody option for Solana in the first place), so this decision doesn't block or shape Solana's adapter.

This is a **deferral, not a resolution** — it remains tracked in `docs/blockchain-integration.md` and ADR-009's Future Improvements, unchanged in status by this ADR.

## 5. Scoping `BlockchainAdapter` for Solana

Before any Solana code is written, here is what Solana needs from the interface that neither EVM nor Bitcoin needed, and whether the existing shape accommodates it:

| Concern | EVM | Bitcoin | Solana | Fits current interface? |
|---|---|---|---|---|
| Transaction validity window | Nonce (monotonic, no expiry) | None (UTXO) | Recent blockhash, expires ~60-90s after fetch | **No new field needed on `TransferRequest`/`BlockchainTransaction`** — this is entirely an adapter-internal concern. `SolanaAdapter.submitTransfer` fetches a fresh blockhash immediately before signing; nothing about "how recent a blockhash the adapter used" needs to be visible to `TransferService` or `ConfirmationProcessor`. |
| Fee/cost accounting | `gasUsed` (bigint, gas units) | None (`gasUsed: null`) | Compute units consumed, plus a separate lamports fee | `gasUsed` can hold compute units cast to `bigint` (both are unitless integers meaningful only within their own chain), consistent with how it's already `null` for Bitcoin. Lamports fee is not currently captured for any chain (EVM doesn't surface actual gas cost paid either, only `gasUsed`), so this is not a regression — it's an existing gap, not a new one. |
| Finality granularity | Binary (mined + status) | Binary (confirmations > 0) | Three levels: `processed` (seen, unconfirmed) → `confirmed` (voted on by supermajority) → `finalized` (~32 blocks deep, irreversible) | **The tri-state `ConfirmationStatus` from this ADR is necessary but not sufficient.** Naively mapping `processed`→`pending`, `confirmed`/`finalized`→`confirmed` would work for `ConfirmationProcessor`'s retry logic, but throws away the `confirmed`-vs-`finalized` distinction a caller might reasonably want (e.g. to decide when a transfer is safe to treat as economically final vs. merely likely-final). **Decision: extend, don't redesign.** Add an adapter-optional `confirmationLevel?: string` (or similar) field to `BlockchainTransaction` for chains that have more than one non-pending level, read by `ConfirmationProcessor` only for logging/observability, not for the `pending`/`confirmed`/`failed` state-machine branch itself. This keeps the shared interface's core three-state contract intact — which is what `ConfirmationProcessor` actually branches on — while giving Solana (and any future chain with graduated finality) a place to report the extra detail without a discriminated union. |
| Custody | App-held key via `SignerService` | Delegated to Bitcoin Core's own wallet | No external-node-wallet equivalent exists for Solana | Solana will need its own custody decision, structurally closer to EVM's (an app-held keypair per wallet) than to Bitcoin's. This is a new decision, not a reuse of either existing pattern, and should be made explicitly when the Solana adapter is scoped — the same mistake (defaulting into a custody model as a side effect of scoping narrowly) should not repeat a third time. |

**Conclusion:** the shared `TransferRequest`/`BlockchainTransaction` interface holds for a third chain with one small, additive change (`confirmationLevel?`), not a rewrite into a discriminated union. The nonce-vs-blockhash-vs-UTXO difference and the gas-vs-compute-units difference were already accommodated by ADR-009's original design (unused/null fields per chain); only the two-vs-three-level finality distinction needed new surface area, and it was possible to add without touching `ConfirmationProcessor`'s core branching logic.

---

# Consequences

## Positive

- Bitcoin transactions now reach `CONFIRMED` correctly. Before this ADR, no Bitcoin transaction could ever reach a terminal state through normal operation: it was either marked `FAILED` while still pending (the ADR-009 gap) or stuck in `CONFIRMING` forever once actually mined (the newly-discovered `blockheight` bug). Both are fixed together, tested with a real getrawtransaction → getblockheader flow.
- `ConfirmationProcessor`'s retry categorization (pending vs. genuine error) is now chain-agnostic, closing a gap that would otherwise have needed re-discovering for Solana.
- The Solana scoping work (point 5) was done as analysis before implementation, per the plan — no Solana code had to be written and then reworked to discover these requirements.

## Negative

- `confirmationLevel?` is speculative — no adapter populates it yet. It's added now, ahead of need, specifically so the Solana adapter doesn't have to touch `BlockchainTransaction` again when it lands. If Solana's adapter ends up not needing it in the form scoped here, it should be removed rather than left as more interface debt.
- The Bitcoin custody deferral (point 4) is now deferred across two ADRs (009 and 010). Deferring a decision twice is a real signal that it's more likely to keep getting deferred than to get scheduled — this is named explicitly rather than left implicit, so a third deferral doesn't happen silently.
- `TransactionPendingError`'s reuse of `handleConfirmationError`'s string-matching approach for "is this retryable" (`error.message.includes(...)`) is somewhat brittle — it will need a fourth pattern for Solana's own "not found yet" error shape when that adapter is built, extending an already-growing conditional rather than a structured discriminator. This wasn't redesigned in this ADR because the fix needed to land now; a structured `isRetryable(error)` per-adapter method is a reasonable follow-up if a fourth chain makes the string-matching approach unwieldy.

---

# Alternatives Considered

## Fix only the confirmation-status bug, leave the block-height bug for later

Rejected once discovered, because fixing only the first bug would have shipped a *worse* observable outcome for Bitcoin (permanently stuck `CONFIRMING` instead of incorrectly-fast `FAILED`) — the two bugs needed to be understood and fixed together to actually improve Bitcoin's behavior rather than just move where it broke.

## Discriminated union per chain instead of `confirmationLevel?`

Considered for representing Solana's three-level finality properly. Rejected for the same reason ADR-009 rejected it originally: it would push a chain-type switch into `ConfirmationProcessor`, which currently only needs to know `pending`/`confirmed`/`failed` to do its job correctly. An optional, adapter-populated detail field preserves that simplicity while still letting richer chains report more.

## Build per-wallet Bitcoin custody now, since it was flagged in ADR-009

Rejected for this pass — see point 4. Tracked, not solved.

## Give `ConfirmationStatus` a fourth value instead of an EVM-adjacent `TransactionPendingError`

Considered representing "pending" as a return value (`status: 'pending'`) that `ConfirmationProcessor` branches on directly, rather than throwing `TransactionPendingError`. This was in fact the initial design (see point 1) — the interface *does* return `status: 'pending'` as data. `TransactionPendingError` is thrown by `ConfirmationProcessor` itself, one layer up, specifically so the pending case flows through the exact same BullMQ retry/backoff mechanism as every other retryable failure, instead of `ConfirmationProcessor` needing a second, parallel "just return without doing anything" code path alongside its existing throw-to-retry pattern.

---

# Future Improvements

* Populate `confirmationLevel` once the Solana adapter exists, and confirm in practice whether `ConfirmationProcessor` ever needs to branch on it (not just log it) — if it never does, remove the speculative field rather than carry it unused.
* Make the Bitcoin custody decision for real — per-wallet descriptors/PSBTs, or an explicit, permanent acceptance of shared custody with compensating controls (e.g. withdrawal limits enforced at the application layer instead of at the key level).
* Replace `handleConfirmationError`'s growing string-match list with a structured `isRetryable(error): boolean` (or similar) per adapter, before a fourth chain makes the current approach hard to follow.
* Make the Solana custody decision explicitly when that adapter is scoped, rather than defaulting into whichever is less work.
