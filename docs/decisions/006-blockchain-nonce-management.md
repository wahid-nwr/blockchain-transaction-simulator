# ADR-004: Blockchain Transaction Nonce Management

- **Status:** Accepted
- **Date:** 2026-08-19
- **Decision:** Use a shared Viem nonce manager per custodial blockchain account
- **Scope:** Blockchain transaction submission

## Context

The platform submits multiple blockchain transactions concurrently from custodial wallets.

A blockchain account has a monotonically increasing transaction nonce. Transactions submitted from the same account must use unique, correctly ordered nonces.

Previously, the platform created a new Viem wallet/account instance for each transaction submission. Under concurrent load, multiple requests could independently resolve the same account nonce.

This resulted in errors such as:

- `Nonce provided for the transaction is lower than the current nonce of the account`
- `transaction already imported`

The problem was particularly visible when multiple API requests submitted ERC-20 transfers concurrently from the same custodial wallet.

The confirmation worker's concurrency and scheduling are independent of nonce allocation. Nonce correctness must therefore be guaranteed at transaction submission time.

## Decision

Use Viem's `createNonceManager()` with a `jsonRpc()` nonce source for custodial blockchain accounts.

A nonce manager is shared per blockchain sender address within the API process.

The effective architecture is:

    TransferService
          |
          v
    SignerService
          |
          v
    WalletClient
          |
          v
    Local Account
          |
          v
    Shared Nonce Manager
          |
          v
    Ethereum-compatible RPC

The nonce manager is responsible for allocating unique nonces to concurrent transactions originating from the same sender.

Different sender accounts have independent nonce managers.

Conceptually:

    Wallet A -> Nonce Manager A
                  |
                  +-- nonce N
                  +-- nonce N+1
                  +-- nonce N+2

    Wallet B -> Nonce Manager B
                  |
                  +-- nonce M
                  +-- nonce M+1

Nonce management remains below the business-service layer. `TransferService` does not explicitly calculate or maintain blockchain nonces.

## Implementation

The blockchain client maintains nonce-manager state keyed by the sender's Ethereum address.

The wallet client is created using a Local Account configured with the shared nonce manager.

Transaction submission therefore remains simple:

    walletClient.writeContract({
        address,
        abi,
        functionName: 'transfer',
        args,
    })

The transaction service does not need to call `getTransactionCount()` or manually calculate the next nonce.

## Blockchain/Test Lifecycle

Nonce-manager state is process-local and must correspond to the lifecycle of the underlying blockchain state.

When the local Anvil blockchain is reset during integration tests, cached nonce-manager state is also reset.

The required lifecycle is:

    Reset database
          |
          v
    Reset Anvil
          |
          v
    resetNonceManagers()
          |
          v
    First transaction re-synchronizes nonce state

This prevents stale nonce state from a previous blockchain lifecycle from being reused against a newly reset chain.

## Validation

The nonce-management implementation was validated under concurrent load.

Load test:

- Virtual users: 15
- Duration: 60 seconds
- Completed transfer flows: 484
- HTTP requests: 1,729
- HTTP failures: 0
- Transfer confirmations: 484/484
- Confirmation rate: 100%
- Transfer submission latency p95: 37.84 ms

Before nonce management was introduced, concurrent load produced nonce-related transaction failures and a confirmation rate of approximately 74%.

After introducing the shared nonce manager, the same class of concurrent workload achieved a 100% confirmation rate.

The integration test suite also verifies that nonce-manager state is correctly reset when the test blockchain is recreated.

## Consequences

### Positive

- Prevents duplicate nonce allocation for concurrent submissions from the same account.
- Removes nonce calculation from business logic.
- Keeps nonce management close to the blockchain signing layer.
- Preserves the existing `TransferService` API.
- Supports concurrent transactions from different sender wallets independently.
- Significantly improves transaction submission reliability under concurrent load.
- Makes nonce behavior explicit and testable.

### Negative

- Nonce-manager state is process-local.
- The nonce manager must be reset when the underlying blockchain state is reset.
- The current implementation does not coordinate nonce allocation between multiple API instances.

## Horizontal Scaling Consideration

The current implementation is correct for a single API process.

It is not sufficient if multiple API instances can submit transactions from the same custodial blockchain account:

    API instance 1 ----\
    API instance 2 -----+---- same blockchain account
    API instance 3 ----/

Each process would maintain its own nonce-manager state and could allocate the same nonce.

Before horizontally scaling transaction submission across multiple API instances, nonce allocation must become distributed.

Possible future approaches include:

- Redis-backed nonce allocation
- PostgreSQL-backed nonce allocation with row-level locking
- A dedicated transaction submission/nonce coordinator
- Another distributed serialization mechanism

This is intentionally deferred until horizontal transaction-submission scaling is required.

## Alternatives Considered

### Manually calling `getTransactionCount()`

Rejected.

Calling `getTransactionCount()` for every transaction does not provide atomic allocation.

Concurrent requests can observe the same nonce:

    Request A -> nonce 42
    Request B -> nonce 42

Both requests can then attempt to submit transactions using nonce 42.

### Manually incrementing a process-local counter in TransferService

Rejected.

This would couple blockchain nonce management to business logic and would require additional handling for initialization, failures, retries, and blockchain resets.

### Explicitly passing a calculated nonce from TransferService

Rejected.

Nonce calculation belongs to the blockchain/account layer rather than the transaction business service.

### Distributed nonce management

Deferred.

A distributed solution is necessary for multiple API instances sharing the same sender account, but would introduce additional coordination complexity that is not required by the current single-process deployment.

## Related Components

- `src/blockchain/client.ts`
- `src/services/signer.service.ts`
- `src/services/transfer.service.ts`
- `test/integration/blockchain.lifecycle.test.ts`
- `resetNonceManagers()`

## Result

The platform now provides process-local, concurrency-safe nonce allocation for custodial blockchain accounts while keeping nonce management isolated from transaction business logic.