# Transaction Lifecycle

## Overview

The Blockchain Transaction Simulator implements a complete blockchain transaction lifecycle similar to production payment and asset-transfer platforms.

A transaction moves through multiple stages:

1. Request validation
2. Database persistence
3. Blockchain submission
4. Transaction hash attachment
5. Blockchain confirmation
6. Event indexing
7. Balance synchronization

The lifecycle is designed around:

* Explicit transaction states
* Asynchronous blockchain confirmation
* Failure handling
* Idempotent processing
* Auditability

---

# Transaction State Machine

The transaction lifecycle is represented as:

```text
                    Client Request
                          |
                          v
                    Transaction Created
                          |
                          v
                       PENDING
                          |
                          |
                          v
                 Blockchain Submission
                          |
                          v
                    HASH_ATTACHED
                          |
                          |
                          v
              Confirmation Worker Polling
                          |
              +-----------+-----------+
              |                       |
              v                       v
        CONFIRMED                 FAILED
              |
              |
              v
       Event Processing
              |
              |
              v
      Balance Synchronization
```

---

# Transaction Creation Flow

## Step 1: API Request

The client submits a transaction request.

Example:

```http
POST /api/v1/transactions
```

Request contains:

* Source wallet
* Destination wallet
* Token
* Amount
* Signer information

---

## Step 2: Validation

The API layer validates:

* Wallet addresses
* Token identifiers
* Transfer amount
* Required authentication context

Validation uses Zod schemas.

Invalid requests are rejected before reaching the blockchain layer.

---

## Step 3: Transaction Persistence

A transaction record is created before blockchain submission.

Initial state:

```text
PENDING
```

Example:

```json
{
  "id": "tx-123",
  "status": "PENDING",
  "amount": "100",
  "tokenId": "token-1"
}
```

This provides:

* Audit history
* Failure recovery
* Transaction tracking

---

# Blockchain Submission Flow

After database persistence, the transaction is submitted to the blockchain.

Flow:

```text
Transaction Service

        |
        v

Transfer Service

        |
        v

Wallet Client

        |
        v

Ethereum RPC

        |
        v

Blockchain Transaction
```

The system uses:

* viem wallet client
* Ethereum-compatible RPC
* Smart contract interaction

---

# Transaction Hash Attachment

After successful blockchain submission:

```text
Blockchain Transaction
          |
          v
Transaction Hash
          |
          v
Database Update
```

The transaction record is updated:

```json
{
  "status": "PENDING",
  "txHash": "0xabc123"
}
```

The blockchain hash becomes the bridge between:

* Application transaction
* Blockchain transaction

---

# Confirmation Worker

## Purpose

Blockchain confirmation is asynchronous.

The API request does not wait indefinitely for blockchain finality.

Instead, a background worker monitors pending transactions.

Location:

```text
src/workers/confirmation.processor.ts
```

---

# Confirmation Process

The worker periodically:

1. Fetches pending transactions
2. Queries blockchain receipt
3. Determines transaction result
4. Updates application state

Flow:

```text
              Pending Transactions

                       |
                       v

          getTransactionReceipt()

                       |
              +--------+--------+
              |                 |
              v                 v

        Receipt Found       Receipt Failed

              |                 |

              v                 v

        CONFIRMED           FAILED
```

---

# Successful Confirmation

When blockchain receipt is successful:

The system stores:

* Transaction status
* Block number
* Gas usage
* Confirmation timestamp

Example:

```json
{
  "status": "CONFIRMED",
  "blockNumber": 100,
  "gasUsed": "50000",
  "confirmedAt": "2026-07-29T10:00:00Z"
}
```

---

# Failed Transaction Handling

Transactions may fail because of:

* Blockchain execution failure
* RPC errors
* Receipt failure
* Contract rejection

Failed transactions are recorded:

```json
{
  "status": "FAILED"
}
```

The failure remains visible for:

* Investigation
* Reporting
* Recovery workflows

---

# Event Indexing

A confirmed blockchain transaction may produce events.

Example ERC20 transfer:

```text
Transfer Event

      |
      v

Event Listener Worker

      |
      v

TokenTransfer Record
```

The event listener:

* Reads blockchain logs
* Parses transfer events
* Persists token movements

---

# Event Processing Flow

```text
Blockchain Event

        |
        v

Event Listener

        |
        v

Duplicate Check

        |
        +------------+
        |            |
        v            v

 Existing       New Event

 Ignore         Persist

```

---

# Duplicate Protection

Blockchain event processing must be idempotent.

The system prevents duplicate records using:

* Transaction hash
* Event log index
* Event cursor tracking

Example uniqueness:

```text
(transactionHash + logIndex)
```

This allows safe retries and replay.

---

# Balance Synchronization

After events are indexed:

The system synchronizes balances.

Flow:

```text
Token Transfer

        |
        v

Balance Sync Service

        |
        v

Blockchain balanceOf()

        |
        v

Balance Snapshot
```

Balance snapshots provide:

* Historical tracking
* Reporting capability
* Audit support

---

# Error Handling Strategy

The lifecycle handles failures at each stage.

## API Failure

Example:

* Invalid request
* Authentication failure

Result:

```text
Request rejected
```

---

## Blockchain Submission Failure

Example:

* RPC unavailable
* Contract execution failure

Result:

```text
Transaction remains FAILED
```

---

## Confirmation Failure

Example:

* Receipt lookup failure
* Temporary RPC error

Result:

```text
Worker retries later
```

---

## Event Processing Failure

Example:

* Duplicate event
* Database failure

Result:

```text
Safe retry without duplicate records
```

---

# Observability During Lifecycle

Each lifecycle stage emits operational signals.

## Logs

Examples:

```text
transaction.created

transaction.submitted

transaction.confirmation.started

transaction.confirmed

transaction.failed
```

---

## Metrics

Tracked metrics include:

```text
transactions_created_total

transactions_confirmed_total

transactions_failed_total

transaction_confirmation_duration_seconds
```

RPC activity:

```text
blockchain_rpc_requests_total

blockchain_rpc_failures_total

blockchain_rpc_duration_seconds
```

---

# Design Decisions

## Why Persist Before Blockchain Submission?

Persisting first provides:

* Transaction audit trail
* Recovery capability
* Visibility into pending operations

---

## Why Use a Worker?

Blockchain confirmation time is unpredictable.

A worker provides:

* Non-blocking APIs
* Retry capability
* Better scalability

---

## Why Use Events?

Blockchain state changes externally.

Event-driven synchronization provides:

* Replay capability
* Deterministic processing
* Better consistency guarantees

---

# Future Improvements

Possible extensions:

* Configurable confirmation depth
* Transaction retry policies
* Dead-letter queue for failed events
* Distributed worker execution
* Blockchain reorganization handling
* Multiple blockchain network support
