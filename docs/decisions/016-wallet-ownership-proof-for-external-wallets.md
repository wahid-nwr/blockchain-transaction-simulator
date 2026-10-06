# ADR 016: Proof of Ownership for EXTERNAL Wallets

# Status

Accepted

# Context

`POST /wallets` registers an address as an `EXTERNAL` wallet with no check that the caller controls it. `Wallet.address` is unique, so registration is first-come-first-served: on a public deployment anyone can register an address they do not own, locking the real owner out of it and attaching that address's indexed activity (balances, transfers) to the wrong account. It does not matter locally; it matters as soon as real users with real wallets can reach the API.

[ADR-015](015-custodial-wallet-provisioning-and-signing-precondition.md) fixed the other half of the wallet story (platform-held keys). This one covers wallets the platform never holds a key for.

# Decision

Registering an `EXTERNAL` wallet can require a signed challenge, in three steps:

1. `POST /wallets/challenge` with `{ chainId, address }` returns `{ message, challenge, expiresAt }`.
2. The user signs `message` with the wallet (EIP-191 `personal_sign`; in a browser, `signMessage` from wagmi or viem).
3. `POST /wallets` with `{ chainId, address, challenge, signature }`.

**Stateless.** `challenge` is an HMAC-signed claim set binding tenant, user, chain, address, a random nonce and a five-minute expiry. The server rebuilds `message` from those claims, so the client cannot choose what is signed, and a challenge cannot be reused for another user, address or chain. No table and no migration. The token is a different format from the access JWT and is MACed under a key derived with a domain-separation label, so one can never be mistaken for the other. Replaying a used proof is harmless because the address is by then already registered.

**Switch.** `REQUIRE_WALLET_OWNERSHIP_PROOF`. Off by default, so local development and the e2e fixtures (which register arbitrary addresses) are unchanged; on in `.env.production.example`. It is parsed strictly: a typo such as `ture` throws at startup instead of silently meaning "off". When off, a proof that is offered must still be valid.

**Chain support.** `BlockchainAdapter.verifyOwnership` is optional. EVM implements it (EOA signatures, via viem's `verifyMessage`); Bitcoin and Solana do not. When proof is required for a chain that cannot verify it, registration is refused rather than silently skipped (fail closed).

**Ordering.** The proof is checked before the "already registered" check, so someone who cannot prove an address learns nothing about whether it is taken. A malformed or wrong signature resolves to a clean `403 INVALID_OWNERSHIP_SIGNATURE`, never a 500.

# Consequences

- Address squatting is closed for EVM wallets once the switch is on.
- A frontend registers an external wallet with two calls and one wallet signature; no gas.
- **Watch-only already works.** The indexer finds wallets by address regardless of custody, so balances and `TokenTransfer` rows for a registered `EXTERNAL` wallet are tracked today. What is missing is an endpoint that lists indexed transfers per wallet; the ledger endpoints only show transfers the platform itself submitted.
- Contract wallets (ERC-1271 / Safe) cannot register under the requirement, because verification is an `ecrecover` check with no RPC call. Supporting them would add an `eth_call` per registration.
- Solana is a natural next adapter (ed25519 verification) but is not needed for an EVM testnet deployment.
- `Wallet.address` is still globally unique across tenants, so the same real address cannot be registered in two tenants.
- No column records that an address was verified. With the switch on, every `EXTERNAL` wallet is verified by construction; if the switch is ever turned on after wallets exist, an `ownershipVerifiedAt` column would be needed to tell old from new.
- The challenge MAC key is derived from `JWT_SECRET`, so rotating that secret invalidates outstanding challenges (they expire in five minutes anyway).
