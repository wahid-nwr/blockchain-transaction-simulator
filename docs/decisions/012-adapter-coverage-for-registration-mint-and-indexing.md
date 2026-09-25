# ADR 012: Extending Adapter Coverage to Registration, Minting, and Event Indexing

## Status

Accepted

## Date

2026-09-24

---

# Context

[ADR-009](009-blockchain-adapter-pattern.md) through [ADR-011](011-solana-adapter-custody-and-infra.md) built and proved out `BlockchainAdapter` for the two operations every transfer needs: `submitTransfer` and `getTransaction`. `TransferService` and `ConfirmationProcessor` resolve an adapter from `token.blockchain` and never import a chain-specific client directly. That part of the platform is genuinely chain-agnostic today, through the API, for all three chains.

Three other operations are not:

* **Token registration** (`POST /tokens`). `registerTokenSchema` has no `blockchain` field at all. `TokenRepository.create`/`findByContractAddress`/`exists` unconditionally `.toLowerCase()` the `contractAddress` before storing or querying it — the exact case-folding mistake [ADR-011](011-solana-adapter-custody-and-infra.md#6-a-real-pre-existing-bug-found-and-fixed-address-case-folding) already found and fixed for `Wallet` addresses, just not yet applied to `Token`. A Solana mint address (base58, case-sensitive) registered through this path today would be silently corrupted on write.
* **Minting** (`POST /tokens/:id/mint`). `MintService` calls viem's `writeContract` directly; `mintTokenSchema` validates the receiver with viem's `isAddress`. Neither goes through the registry.
* **Event indexing** (`src/workers/event.listener.ts`, driven by `EventListenerWorker.processCycle`). `processTokenEvents` is hardcoded to viem's `getLogs`. `processCycle` loads every row from `Token` and calls `processTokenEvents` on all of them regardless of `blockchain`.

None of the three route through `blockchainAdapterRegistry`. In practice this was invisible because only EVM tokens have ever been registered — through `POST /tokens` in tests, or, in local/dev workflows, entirely outside the API via `scripts/register-token.ts` and `scripts/mint.ts`, which call `TokenRepository`/`MintService` directly and bypass both the HTTP layer and whatever validation lives there. That script-based path is the "e2e written process" this ADR replaces: two ways to register or mint a token (API route, hand-run script) that can silently diverge, which is the same shape of problem [incident 001](../incidents/001-worker-entrypoint-stub.md) already documents for a different pair of divergent paths.

## What registering isn't the same thing as, on Bitcoin and Solana

Before deciding how to generalize registration, mint, and indexing, it's worth being precise about what actually exists on each chain today, because the honest answer changes the scope:

* `EvmAdapter` operates on an ERC20-style contract (`MiniUSDT`) — a genuine token layer, separate from the network's native asset.
* `BitcoinAdapter.submitTransfer` sends native BTC via `sendtoaddress`. There is no contract, no mint instruction, and no Transfer-log analogue — Bitcoin has no token layer in this system at all.
* `SolanaAdapter.submitTransfer` sends native SOL via `SystemProgram.transfer` (see [ADR-011](011-solana-adapter-custody-and-infra.md)). It does not touch the SPL Token program. Solana has no token layer in this system either, today.

So "make token registration/minting/indexing chain-agnostic" cannot mean "give Bitcoin and Solana adapters an ERC20-shaped mint/event-log implementation" — there is nothing on either chain for such an implementation to wrap. Pretending otherwise would mean fabricating behavior nothing currently needs, in the same spirit ADR-009 already rejected for the shared `TransferRequest`/`BlockchainTransaction` shape ("a shared shape with some chain-specific fields left optional... two chains' worth of mostly overlapping, a few unused fields"). Forcing three adapters to symmetrically implement a token/mint/event-log capability that only one of them has a referent for would produce exactly that kind of dead-field impurity, at a larger scale, for no present benefit.

---

# Decision

Extend the existing adapter pattern — the same shape of change ADR-009 and ADR-011 already used for Bitcoin and Solana — rather than introduce a second mechanism. Concretely:

## 1. `BlockchainAdapter` gains a required capability check and an optional mint operation

```ts
export interface MintRequest {
    assetIdentifier: string;
    toAddress: string;
    amount: bigint;
}

export interface MintResult {
    txHash: string;
}

export interface BlockchainAdapter {
    readonly chain: string;

    submitTransfer(request: TransferRequest): Promise<TransferSubmission>;
    getTransaction(txHash: string): Promise<BlockchainTransaction>;

    /** Whether `identifier` is a well-formed asset identifier on this chain
     *  (an EVM contract address, today; nothing on Bitcoin or Solana yet —
     *  see "What registering isn't the same thing as" above). Required on
     *  every adapter so registration can reject a malformed or
     *  wrong-chain-shaped identifier before it reaches storage, the same
     *  way `isValidWalletAddress` already gates wallet creation. */
    validateAssetIdentifier(identifier: string): boolean;

    /** Present only on adapters for chains with an actual mint-capable
     *  token layer. Absent, not a throwing stub, on Bitcoin and Solana —
     *  see "A capability that two adapters genuinely don't have" below. */
    mint?(request: MintRequest): Promise<MintResult>;
}
```

`EvmAdapter.mint` wraps the existing `MintService` unchanged — `MintService`'s privileged-operator-key signing model (mint is an admin-gated platform operation, not a per-wallet action) was correct before this change and stays correct; the adapter is a thin dispatch point in front of it, not a rewrite. `EvmAdapter.validateAssetIdentifier` is viem's `isAddress`. `BitcoinAdapter.validateAssetIdentifier` and `SolanaAdapter.validateAssetIdentifier` both return `false` unconditionally, each with a comment pointing at this ADR, rather than silently accepting an identifier nothing downstream can act on.

## 2. A capability that two adapters genuinely don't have

`mint` is declared optional (`mint?`) rather than required-and-throwing, and `TokenService.mintToken` checks for its presence before calling it, returning a new `Errors.unsupportedChainCapability('mint', token.blockchain)` (400) when absent. This mirrors the interface exactly reflecting what's true — an absent method, not a method whose only implementation is `throw` — the same reasoning ADR-009 used for leaving `assetIdentifier`/`gasUsed` optional rather than required-but-usually-null. If SPL minting is added to `SolanaAdapter` later, it's a pure addition (implement the method) with no interface change and no caller change, which is the concrete payoff of getting this shape right now rather than papering over it with a throwing stub.

## 3. Token registration goes through the registry, and the case-folding bug gets fixed the same way ADR-011 fixed it for wallets

`registerTokenSchema` gets a `blockchain: z.nativeEnum(Blockchain).default('EVM')` field (the Prisma column already exists and already defaults to `EVM`; only the API boundary was missing it). `TokenService.registerToken` validates `contractAddress` via `blockchainAdapterRegistry.get(blockchain).validateAssetIdentifier(contractAddress)`, throwing `Errors.invalidAssetIdentifier` on failure, before ever reaching the repository.

`TokenRepository` stops unconditionally lowercasing `contractAddress`. A new `normalizeContractAddress(blockchain, contractAddress)` in `src/blockchain/token-identifier.ts` — deliberately small and separate from `wallet-address.ts`'s `normalizeWalletAddress`, since a `Token` is keyed by the `Blockchain` enum and a `Wallet` by numeric `chainId` (see Future Improvements) — case-folds only for `EVM` (cosmetic EIP-55 checksum casing, exactly as `wallet-address.ts` already reasons for EVM wallet addresses) and leaves everything else untouched. Today that "everything else" branch is unreachable in practice, since `validateAssetIdentifier` rejects any non-EVM registration before the repository is called — but it's written as chain-aware now rather than left as a blanket `.toLowerCase()` that would silently corrupt the first real Solana or Bitcoin identifier the moment either adapter's `validateAssetIdentifier` stops returning `false`.

## 4. Event indexing is scoped to what actually needs it, not forced to false symmetry

Given point 1 above — Bitcoin and Solana have no Transfer-log (or equivalent) analogue to index, because neither has a token layer — `getTransferEvents` was **not** added to `BlockchainAdapter`. Inventing one for two chains with nothing to return from it would be exactly the dead-capability problem this ADR otherwise avoids for `mint`.

Instead, `EventListenerWorker.processCycle` and `processTokenEvents` now check `token.blockchain === Blockchain.EVM` before doing any chain-specific work, logging and returning cleanly for anything else instead of calling viem's `getLogs` on a non-EVM `contractAddress` (which, before this change, would throw or behave unpredictably — no Bitcoin or Solana token has ever actually reached this code path in production, but registering one today would have hit it). This is a narrower, more honest fix than generalizing the interface: it stops the indexer from assuming every `Token` row is EVM, without pretending Bitcoin or Solana event indexing exists when it doesn't.

If SPL token support is added to `SolanaAdapter` later, indexing SPL Transfer instructions is a real, separate design problem — Solana's signature/instruction history is a structurally different shape from EVM's `eth_getLogs`, not a drop-in implementation of the same interface — and should get its own ADR when it's actually needed, the same way Bitcoin's and Solana's `submitTransfer`/`getTransaction` each got their own design pass in ADR-009 and ADR-011 rather than being assumed from EVM's shape.

## 5. The manual scripts are retired, not left as a second path

`scripts/register-token.ts` and `scripts/mint.ts` are deleted. Both operations are now reachable, correctly, through the API (`POST /tokens`, `POST /tokens/:id/mint`) with the validation this ADR adds — there's no remaining reason for a second, unvalidated path to the same effect. `scripts/deploy-mini-usdt.ts` is kept: contract deployment is inherently one-off, chain-specific tooling with no generic "deploy a token" API to build around it, unlike registration and minting, which are ordinary repeated operations a real caller needs through the API.

---

# Consequences

## Positive

* Registration and minting are now reachable, validated, and chain-dispatched entirely through the API — no hand-run script required, and none left around to drift out of sync with it.
* The Solana/Bitcoin case-folding bug class ADR-011 found for wallets is closed for tokens too, before it had a chance to actually corrupt a real identifier (unlike the wallet case, which was live).
* `EventListenerWorker` no longer assumes every registered token is EVM; registering a Bitcoin or Solana token (once `validateAssetIdentifier` allows it, whenever that happens) won't make the indexer throw on every cycle.
* The `mint?` optionality is additive-only for future chains — implementing SPL minting later touches `SolanaAdapter` and nothing else, the same "adding a chain doesn't touch the other chains' code" property ADR-009 established for `submitTransfer`/`getTransaction`.

## Negative

* `TokenService`'s constructor signature changes (drops a direct `MintService` dependency in favor of the registry), and `mintTokenSchema`'s receiver validation is loosened from a hard EVM `isAddress` check to a bare non-empty string, with the real per-chain check now living inside `EvmAdapter.mint` — consistent with how `createWalletSchema` already leaves address-shape validation to the service layer, but a real behavior change for any caller that relied on the schema itself rejecting a malformed EVM receiver before this change (it still gets rejected, just one layer later, inside the adapter's `writeContract` call rather than at the Zod boundary).
* Bitcoin and Solana registration is now explicitly rejected (`validateAssetIdentifier` always `false`) rather than silently accepted-but-nonfunctional. This is a deliberate behavior change, not a side effect — see Alternatives Considered — but it does mean there is currently no way to register a Bitcoin- or Solana-denominated "token" concept in this system at all, even though `Blockchain.BITCOIN`/`Blockchain.SOLANA` exist as enum values. Both chains' native-asset transfers work today entirely through `TransferService`/`ConfirmationProcessor` without a `Token` row.
* `getTransferEvents` was deliberately not added to the adapter interface. A reader expecting full symmetry with `submitTransfer`/`getTransaction`/`mint` across all three chains won't find it, and the reasoning (no token layer exists yet on two of three chains) lives only in this document, not in the interface itself.

---

# Alternatives Considered

## Give `BitcoinAdapter`/`SolanaAdapter` a `mint` that throws `NotSupportedError`

Rejected in favor of an absent, optional method. A throwing stub still requires every caller to know to call it inside a try/catch and interpret the specific thrown error, whereas an absent method makes "this chain can't do this" checkable with a plain `if (adapter.mint)` — a smaller, more honest surface, and the same distinction ADR-009 drew between a genuinely-missing capability and a field that's merely usually null.

## Let `validateAssetIdentifier` return `true` for Bitcoin/Solana with an "any format accepted, no chain-specific validation yet" note

Rejected. This would have let registration succeed for a chain with nothing else in the system able to act on the resulting `Token` row — indexing would still have to skip it (point 4 above), and minting would still be absent — producing a `Token` that exists in the database but can't meaningfully do anything, which is a worse failure mode than a clear rejection at registration time.

## Invent a `getTransferEvents` shape now, ahead of any chain actually needing it

Rejected — see "Event indexing is scoped to what actually needs it" above. Designing an event-sourcing interface against zero real implementations beyond EVM risks getting the shape wrong in a way that's only discovered once a second, genuinely different chain (Solana's instruction/signature model, whenever SPL support arrives) tries to implement it — the same risk ADR-009 flagged and explicitly left open for the existing interface ("whether the interface itself scales cleanly to a *very* different chain... is untested by this ADR").

## Fix `Wallet.chainId` vs. `Token.blockchain` as part of this change

Out of scope. [ADR-011's Future Improvements](011-solana-adapter-custody-and-infra.md#future-improvements) already named this as needing a real decision, independent of registration/mint/indexing. This ADR adds one more concrete data point (a second numeric-vs-enum key now exists on `Token`-adjacent code — `normalizeContractAddress` is keyed by `Blockchain`, while `normalizeWalletAddress` is keyed by `chainId`, and the two are not merged here) but doesn't resolve it. Folding that resolution into this change would have coupled an unrelated, larger decision to a change that doesn't need it to ship.

---

# Future Improvements

* Resolve `Wallet.chainId` vs. `Token.blockchain` (tracked since ADR-011; this ADR adds a second concrete instance of the split rather than closing it).
* Design and implement SPL token support for Solana (mint + Transfer-instruction indexing) as its own ADR, if/when a real requirement for it exists — not assumed from this one.
* The still-open, ADR-011-tracked gap that there is no API path to provision a `CUSTODIAL` wallet with a real key applies equally to the newly-API-reachable mint flow: minting to a wallet that was never actually given custodial key material through the API will fail the same way transferring from one already does.
* Chain-tag the event-listener's metrics/logs (`eventListenerEventsProcessedTotal` etc.) with `blockchain`, now that `processTokenEvents` actually branches on it — currently it doesn't distinguish "skipped, non-EVM" from "ran, found nothing" in its metrics, only in its logs.
