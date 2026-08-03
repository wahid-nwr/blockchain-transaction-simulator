# Blockchain Integration Architecture

## Overview

The Blockchain Transaction Simulator integrates with Ethereum-compatible blockchain networks to execute transactions, monitor confirmations, and synchronize blockchain state.

The blockchain integration layer isolates blockchain-specific concerns from application business logic.

The design separates:

* Blockchain clients
* Wallet signing
* Smart contract interaction
* RPC communication
* Transaction monitoring
* Event indexing

---

# Blockchain Architecture

```text
                         Application Services

                                |
                                v

                     Blockchain Integration Layer

                                |
          +---------------------+---------------------+
          |                     |                     |
          v                     v                     v

    Wallet Client        Public Client        Contract Client

          |                     |                     |

          +---------------------+---------------------+

                                |
                                v

                  Ethereum Compatible Blockchain

                                |
                                v

                    RPC Provider / Anvil
```

---

# Technology Stack

The blockchain layer uses:

| Component         | Technology   |
| ----------------- | ------------ |
| Blockchain Client | viem         |
| Local Network     | Anvil        |
| Contract Tooling  | Hardhat      |
| Smart Contracts   | Solidity     |
| Network Interface | Ethereum RPC |

---

# Blockchain Responsibilities

The blockchain layer is responsible for:

* Creating blockchain clients
* Signing transactions
* Calling smart contracts
* Broadcasting transactions
* Reading blockchain state
* Retrieving receipts
* Reading emitted events

It does not contain:

* API logic
* Database workflows
* User authorization
* Business rules

---

# Client Architecture

The system uses different blockchain clients depending on responsibility.

```text
Blockchain Client Types

        |
        +----------------+
        |                |
        v                v

 Public Client       Wallet Client


 Read Operations     Write Operations
```

---

# Public Client

Used for blockchain reads.

Examples:

* Transaction receipt lookup
* Contract state queries
* Event retrieval
* Balance queries

Example operations:

```text
getTransactionReceipt()

readContract()

getLogs()
```

---

# Wallet Client

Used for blockchain writes.

Responsibilities:

* Transaction signing
* Sending transactions
* Contract method execution

Example flow:

```text
Application

    |
    v

Wallet Client

    |
    v

Signed Transaction

    |
    v

Blockchain Network
```

---

# Smart Contract Integration

The project interacts with ERC20-compatible contracts.

Example contract operations:

## Mint Token

```text
Application

     |
     v

Contract Write

     |
     v

Blockchain Transaction

     |
     v

Transfer Event
```

---

## Transfer Token

Flow:

```text
Transfer Request

        |
        v

ERC20 Contract

        |
        v

Blockchain Transaction

        |
        v

ERC20 Transfer Event
```

---

# Transaction Submission Flow

The blockchain submission lifecycle:

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

Contract Method Call

        |
        v

Blockchain RPC

        |
        v

Transaction Hash Returned

        |
        v

Persist Hash
```

---

# Transaction Receipt Handling

Blockchain transactions are asynchronous.

A submitted transaction does not immediately mean success.

The confirmation worker retrieves receipts:

```text
Pending Transaction

        |
        v

getTransactionReceipt()

        |
        +----------------+
        |                |
        v                v

 Receipt Found      Receipt Failed

        |
        v

 Update Lifecycle
```

---

# RPC Communication

All blockchain communication happens through RPC.

Examples:

```text
eth_sendTransaction

eth_getTransactionReceipt

eth_getLogs

eth_call
```

The application treats RPC as an external dependency.

---

# RPC Instrumentation

RPC calls are wrapped using:

```text
src/blockchain/rpc.instrumentation.ts
```

Purpose:

* Measure RPC latency
* Track failures
* Monitor provider health

Flow:

```text
RPC Request

     |
     v

instrumentRpc()

     |
     +----------------+
     |                |
     v                v

Execute Call     Record Metrics

     |
     v

Return Result
```

---

# Event Processing

Blockchain events are consumed asynchronously.

Example ERC20 transfer:

```text
Blockchain Block

        |
        v

Transfer Event

        |
        v

Event Listener Worker

        |
        v

TokenTransfer Record

        |
        v

Balance Synchronization
```

---

# Event Listener Responsibilities

The listener:

* Polls blockchain logs
* Filters contract events
* Parses event parameters
* Validates event data
* Stores processed events

---

# Blockchain State Synchronization

The blockchain is considered the external source of truth.

Synchronization model:

```text
Blockchain State

        |
        v

Indexer

        |
        v

Application Database

        |
        v

Application Queries
```

---

# Failure Handling

Blockchain systems fail in different ways.

## RPC Failure

Examples:

* Provider unavailable
* Network timeout
* Rate limiting

Handling:

* Capture failure metrics
* Log context
* Retry through worker execution

---

## Transaction Failure

Examples:

* Contract revert
* Invalid parameters
* Insufficient funds

Handling:

* Mark transaction FAILED
* Preserve failure information

---

## Event Processing Failure

Examples:

* Database failure
* Temporary processing error

Handling:

* Retry processing
* Maintain event cursor consistency

---

# Local Blockchain Development

The project uses Anvil for local development.

Advantages:

* Fast block creation
* Deterministic accounts
* Local private keys
* Ethereum compatibility

Development flow:

```text
Start Anvil

      |
      v

Deploy Contracts

      |
      v

Configure Addresses

      |
      v

Run Application

      |
      v

Execute Transactions
```

---

# Smart Contract Deployment

Deployment lifecycle:

```text
Solidity Contract

        |
        v

Hardhat Deployment

        |
        v

Contract Address

        |
        v

Application Configuration
```

The application interacts with deployed contract addresses rather than deployment logic.

---

# Security Considerations

## Private Keys

Private keys should never be:

* Stored in source code
* Logged
* Committed to repositories

Production environments should use:

* Secret managers
* Hardware-backed signing
* Dedicated signing services

---

## RPC Security

Production RPC usage should consider:

* Authentication
* Rate limits
* Provider redundancy
* Monitoring

---

# Design Principles

## Blockchain Isolation

Application services should not directly depend on blockchain clients.

---

## External System Awareness

Blockchain operations are treated as:

* Slow
* Asynchronous
* Failure-prone

---

## Observable Integration

All blockchain communication should provide:

* Logs
* Metrics
* Error context

---

# Future Improvements

Planned enhancements:

* Multiple blockchain network support
* WebSocket event subscriptions
* Transaction retry policies
* RPC provider failover
* Confirmation depth configuration
* Chain reorganization handling
* OpenTelemetry blockchain tracing
