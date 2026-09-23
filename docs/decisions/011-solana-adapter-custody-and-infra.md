# ADR 011: Solana Adapter — Custody, Implementation, and a Case-Sensitivity Bug Found Along the Way

## Status

Accepted

## Date

2026-09-20

---

# Context

[ADR-010](010-tri-state-confirmation-status.md) scoped what a third chain would need from the `BlockchainAdapter` interface, specifically ahead of adding Solana: a tri-state `ConfirmationStatus` (already built, to fix a Bitcoin bug) plus an optional `confirmationLevel` field reserved for chains with more than one non-pending finality level. It also flagged three decisions to make deliberately when Solana actually arrived, rather than defaulting into them the way Bitcoin's custody model was defaulted into in [ADR-009](009-blockchain-adapter-pattern.md):

1. Solana's custody model.
2. Whether the shared interface genuinely holds for a third, structurally different chain.
3. Local/E2E infrastructure, following the precedent Bitcoin set.

This ADR records what was actually decided and built, plus two things that weren't part of the plan going in: a real, pre-existing bug the work surfaced, and a longer-than-expected fight with the E2E infrastructure's Docker image.

---

# Decision

## 1. Custody: per-wallet, mirroring EVM — not Bitcoin's node-wallet model

Solana's `SolanaSignerService` (`src/services/solana-signer.service.ts`) mirrors EVM's `SignerService` almost exactly: it resolves a wallet's encrypted key via `WalletRepository.findByIdForTenantWithCustody`, decrypts it, and constructs a signer — a `Keypair`, in Solana's case, rather than a viem account. This was the reasoning ADR-010 anticipated ("an app-held keypair per wallet is the natural default for Solana... there is no Bitcoin-Core-wallet-style external custody option") and it held up: Solana has no node-operated wallet concept to delegate to the way `bitcoind`'s own wallet does, so per-wallet custody was really the only structurally sensible choice, not a close call between two options.

### This let existing custody infrastructure be reused, not duplicated

Rather than building new key-storage plumbing for Solana, `SolanaSignerService` reuses the exact same envelope-encryption/KMS path `SignerService` already uses (`src/crypto/envelope.ts`). That required one change: `encryptWalletKey`/`decryptWalletKey` were typed as `` `0x${string}` `` — an EVM hex-string assumption baked into the type signature, even though the underlying implementation was always just "encrypt/decrypt a UTF-8 string" with nothing EVM-specific in it. Both functions were widened to a generic `string`; behavior is unchanged (EVM callers still round-trip hex, Solana callers round-trip a plain, no-prefix hex-encoded 64-byte secret key — see `SolanaSignerService` for why plain hex was chosen over Solana's more conventional base58 export format: this key never leaves the encryption boundary to be pasted into an external wallet, so there was no reason to match that convention or add a `bs58` dependency for it).

### A real, pre-existing gap this surfaced, not fixed

Building `SolanaSignerService` required understanding exactly how a wallet becomes `CUSTODIAL` with a real key in the first place — and the answer, for every chain including EVM, is: **it doesn't, through the public API.** `WalletService.createWallet` only ever produces `custodyType: EXTERNAL` wallets (the Prisma schema's own default); every `CUSTODIAL` wallet with a real `WalletCustodyKey` in this codebase is created by test factories writing directly to Prisma, bypassing the service layer entirely. `SolanaSignerService` was built to assume a custody key already exists, exactly like `SignerService` already does — this gap predates Solana, affects all three chains equally, and was not fixed as part of this work. It's called out here so it isn't mistaken for something Solana-specific, and so it doesn't quietly disappear from view now that Solana's E2E fixture creates its custodial wallets the same test-factory-bypass way Bitcoin's and EVM's already did.

## 2. A real SDK, not a hand-rolled client — the opposite choice from Bitcoin

`SolanaAdapter` (`src/blockchain/solana/solana.adapter.ts`) uses `@solana/web3.js` directly, the same way `EvmAdapter` uses viem — not a hand-rolled JSON-RPC client the way `BitcoinAdapter` uses `BitcoinRpcClient`. ADR-009 reasoned through this trade-off for Bitcoin ("Bitcoin integration needs exactly two RPC methods... a full Bitcoin library was judged unnecessary complexity"); Solana lands on the opposite side of that same reasoning, for the same kind of reason: constructing and signing a Solana transaction (message compilation, blockhash handling, Ed25519 signing, wire serialization) is genuinely non-trivial, unlike Bitcoin's model where the node's own wallet does all of that and the adapter just asks it to. Hand-rolling that would have meant re-implementing a meaningful slice of what `@solana/web3.js` already does correctly.

## 3. `submitTransfer` and `getTransaction`

`submitTransfer` fetches a recent blockhash immediately before signing (Solana's transaction-validity window — ~60-90 seconds after the blockhash was fetched, expiring afterward — is time-bounded rather than an explicitly-incremented nonce like EVM's, which is exactly the difference ADR-010's scoping table anticipated and confirmed needs no new interface surface: it's entirely an adapter-internal concern), builds a `SystemProgram.transfer` instruction for the request's lamport amount, signs with the resolved `Keypair`, and calls `sendRawTransaction`.

`getTransaction` calls `getSignatureStatuses`, which — like Bitcoin's `getrawtransaction` and unlike EVM's `getTransactionReceipt` — does not throw for a signature it doesn't recognize; it returns `null` in that slot, covering both "still propagating" and "never existed" the same way Bitcoin's mempool case does. That maps to `status: 'pending'`, consistent with the tri-state design from ADR-010.

Solana genuinely has three non-error finality levels — `processed` (seen, not yet voted on), `confirmed` (supermajority voted), `finalized` (~32 blocks deep, irreversible) — one more than `ConfirmationStatus` has room for, exactly as ADR-010's scoping table predicted. Per that scoping: `processed` maps to `'pending'` for `ConfirmationProcessor`'s own retry/terminal branching (it genuinely isn't safe to call a transaction done at that level), while `confirmed` and `finalized` both map to `'confirmed'` — `ConfirmationProcessor` only needs "final and good" vs. "not yet" vs. "final and bad," not the finer distinction. The finer distinction is preserved in the `confirmationLevel` field ADR-010 added specifically for this, read by nothing in `ConfirmationProcessor`'s branching logic — observability only, as designed.

`gasUsed` is populated from `computeUnitsConsumed`, fetched via a second `getTransaction` call made only once a transaction is confirmed — the same "second call, confirmed-only" pattern `BitcoinAdapter` already uses for `getblockheader`. This was the one place ADR-010's scoping table flagged as possibly needing something beyond a straight reuse of the existing `gasUsed` field ("gasUsed can hold compute units cast to bigint... consistent with how it's already null for Bitcoin"); in practice, a straight reuse was sufficient — no new field was needed for this part.

## 4. Config validation stays lazy — matching Bitcoin's pattern, not accidentally breaking it

The first working draft of the adapter registry wiring called `getSolanaConfig()` eagerly, at module-load time in `blockchain-adapters.ts` — which would have thrown on process start in any environment without `SOLANA_RPC_URL` set, including plain local dev and any CI tier that doesn't run Solana. `BitcoinRpcClient` deliberately avoids exactly this (`getBitcoinConfig()` is only called inside `.call()`, never at construction), and that pattern was followed instead: `getSolanaConnection()` (`src/blockchain/solana/connection.ts`) is a lazy, memoized getter, and `SolanaAdapter`'s constructor takes a connection *provider function*, not a live `Connection`, resolving it per-call the way `BitcoinRpcClient.call()` resolves its config per-call.

## 5. `Wallet.chainId` got a third value, with no chain-id to base it on

Wallet address validation (`isValidWalletAddress` in `src/blockchain/wallet-address.ts`) is keyed by `chainId: number` — a pre-existing, EVM-shaped scheme (`ANVIL_CHAIN_ID = 31337`, a real EIP-155 chain ID) that Bitcoin was already fit into awkwardly via an invented `BITCOIN_REGTEST_CHAIN_ID = 18444` (at least derived from something real: Bitcoin regtest's actual default P2P port). Solana has no chain-ID concept at all — there was nothing to derive a value from. `SOLANA_LOCALNET_CHAIN_ID = 900` is a bare, arbitrary sentinel, documented as such in the code rather than dressed up as meaningful. This is the clearest sign yet that `Wallet.chainId` as a scheme doesn't really generalize past "EVM plus awkward exceptions" — see [Future Improvements](#future-improvements).

## 6. A real, pre-existing bug found and fixed: address case-folding

Implementing Solana address validation required deciding whether to normalize (lowercase) Solana addresses the way `WalletRepository.create()` unconditionally lowercased every wallet address on write, and the way `findByAddress()` unconditionally did a case-insensitive lookup. Solana addresses are base58-encoded — **case-sensitive by design**, unlike EVM hex (where casing is a cosmetic EIP-55 checksum) or Bitcoin's bech32 addresses (conventionally lowercase and safe to fold). Lowercasing a base58 address doesn't produce an equivalent address; it produces a **different, wrong one**.

This was not a new problem Solana introduced — it was a latent bug already present for **Bitcoin's own legacy base58 addresses** (the `m`/`n`/`2`-prefixed regtest format `isBitcoinRegtestAddress` already validated), just never triggered, because the Bitcoin E2E fixture happens to only ever generate bech32 (`bcrt1...`) addresses via `getnewaddress`. Solana's addresses are *always* base58, so the bug was unavoidable rather than merely possible, which is what surfaced it now rather than earlier.

Fixed with `isCaseInsensitiveWalletAddress(chainId, address)` and `normalizeWalletAddress(chainId, address)` (`src/blockchain/wallet-address.ts`): EVM and Bitcoin bech32 remain case-folded on write and looked up case-insensitively (unchanged behavior); Bitcoin legacy base58 and Solana addresses are now preserved exactly and compared exactly. `WalletRepository.findByAddress` was changed to take `chainId` as a required parameter specifically so this couldn't be silently bypassed by a caller that forgot to pass it — both of its callers (`WalletService.createWallet`, and `TransferEventService`'s ERC20-event-address lookup, which now explicitly passes `ANVIL_CHAIN_ID` since it only ever handles EVM events) were updated accordingly. `wallet-address.ts` had zero test coverage before this change; it has full coverage of the validity and case-sensitivity behavior for all three chains now.

## 7. E2E infrastructure: no official Solana image, and a real fight to get one working

Bitcoin's E2E infrastructure (ADR-009) used `bitcoin/bitcoin`, an official image, and worked essentially on the first attempt. Solana's did not, for a reason worth recording plainly: **Solana Labs/Anza do not publish an official `solana-test-validator` Docker image.** `docker-compose.e2e.yml` uses `ghcr.io/beeman/solana-test-validator:latest`, the most actively-maintained community build found, but this is a genuinely different trust and staleness posture than Bitcoin's or Anvil's official images, and is flagged as such directly in the compose file.

Getting it running surfaced three distinct, real bugs in sequence, each only found by actually running the container and reading its output — not guessable in advance:

- **Silent failure with no visible error.** The image writes its real log to a file inside the ledger directory by default, not to stdout; `--log` was required to see anything beyond "Initializing..." in `docker compose logs`.
- **`PermissionDenied (os error 13)`** acquiring the ledger lockfile, once a named volume was mounted for persistence. Docker creates named-volume mount points as root by default; unlike Bitcoin's official image (which explicitly chowns its data directory before dropping privileges — visible in its own entrypoint log output), this community image has no equivalent step. Resolved by dropping the volume entirely (`--reset` wipes the ledger every startup anyway, so nothing needed persisting) and pointing `--ledger` at `/tmp`, which is world-writable regardless of which user the image runs as.
- **A gossip-address panic** (`UnspecifiedIpAddr(0.0.0.0)`) from passing `--bind-address 0.0.0.0` — needed so sibling containers could reach the RPC port, but `--bind-address` also supplies the *default* gossip-advertise address, and Agave rejects `0.0.0.0` there. The documented fix, `--advertised-ip`, was tried and had no observed effect — most likely not wired into `solana-test-validator`'s own startup path, only the production validator's, though this was never fully confirmed by reading that specific code path before a different fix was found. The fix that actually worked: resolve the container's own real bridge-network IP via `hostname -i` at container start and use that single, concrete address for `--bind-address` — simultaneously valid as a gossip-advertise address (not unspecified) and reachable from sibling containers (not loopback-only).

The healthcheck was subsequently found, by inspection rather than by hitting it, to have the same-shaped problem one level up: it checked `127.0.0.1:8899`, but the server now binds to a specific non-loopback IP, and there's no general guarantee that also means it's reachable on loopback from inside the same container. The healthcheck now re-resolves the same `hostname -i` address rather than assuming loopback works.

None of these were failures of the *Solana integration design* — `BlockchainAdapter`, `SolanaSignerService`, `SolanaAdapter` did not change because of any of this. They were entirely failures of one specific unofficial Docker image's startup behavior, which is exactly the kind of risk that comes with there being no official one to use instead.

---

# Consequences

## Positive

- Solana transfers work end-to-end through the same `TransactionService` → `BlockchainAdapterRegistry` → adapter path every other chain uses, with zero changes needed to that shared path beyond what ADR-009 already built.
- The tri-state `ConfirmationStatus` design from ADR-010 held up against a real third chain without needing a redesign — only the anticipated, additive `confirmationLevel` field was actually used, exactly as scoped.
- A real, latent bug (base58 case-folding) was found and fixed for Bitcoin's own legacy addresses as a side effect of building Solana correctly, rather than being discovered later as a Bitcoin-specific production incident.
- `encryptWalletKey`/`decryptWalletKey` are now honestly chain-agnostic in their type signatures, matching what they always were at runtime.

## Negative

- **The "no API path to create a custodial wallet" gap is now load-bearing for three chains instead of one.** It was already true for EVM; it's now equally true for Bitcoin (in a different way — delegated custody, no key to provision at all) and Solana. Nothing about this ADR made it worse, but nothing made it better either, and it's more visible now that it's been named three times.
- **`Wallet.chainId` as a numeric scheme is showing real strain.** `SOLANA_LOCALNET_CHAIN_ID = 900` has no relationship to anything Solana-specific, unlike even Bitcoin's borrowed-port-number placeholder. A fourth chain without a natural numeric ID would face the exact same problem with no better answer available yet.
- **The Solana E2E service is the least trustworthy piece of infrastructure in this repository**, by a clear margin — an unofficial, nightly-built, third-party image, versus official images for both other chains. If it goes stale, changes its CLI flags again (as it already did once mid-investigation, per the `--gossip-host` vs. `--advertised-ip` confusion above), or disappears, Solana E2E coverage breaks without any code change having caused it.
- `--advertised-ip` was never conclusively confirmed to be broken for `solana-test-validator` specifically — the investigation moved to a working alternative before that was fully settled. If a future Agave version's CLI changes again, the actual root cause here is not fully closed out, only worked around.

---

# Alternatives Considered

## Give Solana its own hand-rolled JSON-RPC client, like Bitcoin

Rejected — see "A real SDK, not a hand-rolled client" above. Solana's transaction construction and signing are non-trivial enough that a full SDK is the smaller cost, the opposite conclusion from Bitcoin's for the opposite reason (Bitcoin needs almost nothing; Solana needs a lot).

## Store Solana secret keys as base58, matching wallet-export convention

Rejected — see the custody section above. This key is never exported to a human or another tool; matching Solana's own convention would only have added a `bs58` dependency for no behavioral benefit.

## Give `ConfirmationStatus` a fourth value for Solana's three finality levels

Considered, since Solana is the first chain to actually exercise the "more than one non-pending level" case ADR-010 anticipated. Rejected in favor of the `confirmationLevel` field ADR-010 already reserved for exactly this — `ConfirmationProcessor` genuinely doesn't need the finer distinction to do its job, and widening the core enum would have meant updating that branching logic for no behavioral gain.

## Build per-wallet Solana custody as a brand-new system, independent of EVM's

Rejected — see "This let existing custody infrastructure be reused" above. There was no reason to duplicate KMS/envelope handling when the only obstacle was an overly-specific type annotation.

## Keep fighting `--advertised-ip` until its actual behavior on solana-test-validator was fully understood

Rejected pragmatically, not on principle. `hostname -i` produces a container that starts reliably; fully explaining why `--advertised-ip` didn't work would have meant reading `solana-test-validator`'s own startup source (as opposed to the shared `agave-validator` CLI schema, which was read) with no guarantee of a better outcome than what was already working. Left open in [Future Improvements](#future-improvements) rather than closed out.

---

# Future Improvements

* Make a real decision about `Wallet.chainId` vs. `Token.blockchain` as competing "which chain" schemes — `SOLANA_LOCALNET_CHAIN_ID`'s complete arbitrariness is a stronger signal than Bitcoin's was that this needs resolving before a fourth chain, not after.
* Build an actual API path to create a `CUSTODIAL` wallet with a provisioned key, for any chain — currently only reachable via test factories, for EVM, Bitcoin, and now Solana alike.
* Re-evaluate the Solana E2E image's staleness/trust posture periodically, given it's an unofficial nightly build — this is the piece of infrastructure in this repository most likely to break without a corresponding code change.
* Confirm, if it becomes relevant again, whether `--advertised-ip` is genuinely unread by `solana-test-validator`'s own startup path or whether the earlier attempt had some other mistake — currently an open question, not a closed one.
* Cross-validate `Wallet.chainId` against `Token.blockchain` at transfer time (flagged originally in the multi-chain gap audit, still unresolved) — now with three chains' worth of possible chainId/blockchain mismatches instead of two.