# ADR 015: Custodial Wallet Provisioning and the Signing Precondition

# Status

Accepted

# Context

[ADR-011](011-solana-adapter-custody-and-infra.md) recorded a gap that predates every chain: `WalletService.createWallet` can only produce `EXTERNAL` wallets, so the only way to obtain a wallet the platform can sign for (`CUSTODIAL` with a `WalletCustodyKey`) was a test factory writing to Prisma directly. Through the public API alone, no EVM or Solana transfer could ever succeed.

A second problem sat on the same path. `TransferService` wrote a `PENDING` ledger row first and only then asked the signer for a key. Transferring from a wallet the platform cannot sign for therefore created a transaction that was guaranteed to end up `FAILED`, and the caller got `201` with a failed transaction instead of an error.

# Decision

**Provisioning.** `POST /api/v1/wallets/custodial` with `{ chainId }`. The platform generates the keypair (`BlockchainAdapter.createCustodialWallet`, optional like `mint`), encrypts the secret with the existing envelope (`encryptWalletKey`) and stores wallet and key row in a single nested Prisma create, so one can never exist without the other. The response is the wallet row only; key material is never returned or logged. The wallet is always owned by the caller (same rule as wallet registration), and any authenticated `USER` or `ADMIN` may call it.

- EVM stores a `0x`-prefixed hex private key; Solana stores the plain hex of the 64-byte secret key. Both are exactly what the existing signer services already parse.
- New keys are encrypted under `KMS_KEY_ID` (required when `KMS_PROVIDER` is not `local`). Existing rows keep the key id they were encrypted with.
- Bitcoin has no `createCustodialWallet`: custody is delegated to the node wallet, so there is no per-wallet key to provision. The endpoint answers `UNSUPPORTED_CHAIN_CAPABILITY`.

**Precondition.** `BlockchainAdapter.canSign(wallet)` is **required** on every adapter (unlike the optional capabilities) because it is a safety check. `TransferService` calls it before `ledger.createPending`, using `WalletService.getCustodyStatus`, which exposes only `{ custodyType, hasCustodyKey }`.

- EVM and Solana: signable only if `CUSTODIAL` **and** a key row exists.
- Bitcoin: always `true`, because `sendtoaddress` signs through the node wallet. A blanket "must be CUSTODIAL" check in the transfer service would have broken Bitcoin; the decision belongs to the adapter.

A non-signable wallet now yields `409 WALLET_NOT_CUSTODIAL` with no ledger side effects. The status was `404`, which could not be told apart from a missing wallet by status alone. The signers keep their own custody check as a second line of defence.

# Consequences

- The system can be driven end to end through its own API; the manual database steps in the Postman walkthrough are gone.
- Behaviour change: transferring from an `EXTERNAL` EVM or Solana wallet used to return `201` with a `FAILED` transaction and now returns `409`. The one existing test that asserted the old behaviour was updated.
- Required `canSign` means every new chain must answer the question explicitly.
- **Gas is not handled.** A freshly generated wallet holds no native token, so it cannot pay gas until something funds it (Anvil `setBalance` locally; a faucet or a funded treasury key on a public testnet).
- **No abuse controls yet.** Any user can create any number of wallets, and the repo has no rate limiting. That should exist before a public deployment.
- **Local KMS caveat unchanged.** With `KMS_PROVIDER=local` the master key sits beside the ciphertext it protects; use real KMS anywhere keys have value.

# Not decided here

Watch-only handling of `EXTERNAL` wallets and proof-of-ownership for registering an address remain open. `EXTERNAL` still means "the platform will not sign" for EVM and Solana.
