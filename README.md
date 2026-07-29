# Blockchain Transaction Simulator

A production-oriented blockchain transaction processing platform built with **Node.js, TypeScript, Fastify, PostgreSQL, Prisma, and viem**.

The project simulates a real-world blockchain transaction infrastructure with:

* Multi-tenant transaction processing
* Blockchain transaction lifecycle management
* Event-driven blockchain indexing
* Background confirmation workers
* Balance synchronization
* Production-grade observability
* Comprehensive automated testing

The goal is to model how modern backend systems interact with blockchain networks while applying enterprise engineering practices such as separation of concerns, idempotency, structured logging, metrics, and test-driven development.

---

# Architecture Overview

The system is designed around clear separation between API, domain logic, persistence, blockchain integration, and background processing.

```
                         Client
                           |
                           v
                    Fastify REST API
                           |
          +----------------+----------------+
          |                                 |
          v                                 v
 Authentication                      Application Services
          |                                 |
          +----------------+----------------+
                           |
                           v
                     Ledger Layer
                           |
          +----------------+----------------+
          |                                 |
          v                                 v
     PostgreSQL                      Blockchain RPC
     Prisma ORM                      viem Client
                                           |
                                           v
                                  Confirmation Worker
                                           |
                                           v
                                  Event Indexing
```

---

# Technology Stack

## Backend

* Node.js
* TypeScript
* Fastify 5
* Prisma ORM
* PostgreSQL
* Zod validation
* Vitest testing framework

## Blockchain

* viem
* Ethereum-compatible RPC
* Hardhat 3
* Anvil local blockchain
* Solidity smart contracts

## Observability

* Pino structured logging
* Prometheus metrics
* Request correlation IDs
* RPC instrumentation
* Worker lifecycle metrics

---

# Core Features

## Transaction Lifecycle Management

The simulator implements a complete blockchain transaction lifecycle:

```
Transaction Created
        |
        v
PENDING
        |
        v
Blockchain Submission
        |
        v
Transaction Hash Stored
        |
        v
Confirmation Worker Polling
        |
        +----------------+
        |                |
        v                v
   CONFIRMED          FAILED
        |
        v
Event Processing
        |
        v
Balance Synchronization
```

Implemented capabilities:

* Transaction creation
* Blockchain submission
* Transaction hash persistence
* Receipt confirmation
* Confirmation status tracking
* Gas usage recording
* Block number persistence
* Failure handling

---

# Blockchain Event Processing

The platform uses event-driven indexing instead of relying only on database state.

Features:

* ERC20 Transfer event processing
* Event cursor tracking
* Duplicate event protection
* Token transfer persistence
* Balance snapshot synchronization

Benefits:

* Replay capability
* Auditability
* Eventual consistency model
* Reliable blockchain synchronization

---

# Multi-Tenant Design

The application supports tenant isolation across the platform.

Implemented entities:

* Tenant
* Users
* Wallets
* Tokens
* Transactions
* Token Transfers
* Balance Snapshots
* API Keys

The architecture is designed so multiple organizations can operate independently within the same application.

---

# API Capabilities

Implemented APIs include:

## Authentication

* User authentication
* JWT based access
* Refresh token support
* API key management

## Tenant Management

* Tenant creation
* Tenant isolation

## Wallet Management

* Wallet registration
* Wallet ownership tracking

## Token Management

* Token registration
* ERC20 token interaction

## Transactions

* Create blockchain transactions
* Track transaction lifecycle
* Query transaction status

---

# Observability

The project includes production-style observability.

## Structured Logging

Implemented with Pino:

Example:

```json
{
  "operation": "transaction.confirmed",
  "transactionId": "tx-123",
  "txHash": "0xabc",
  "blockNumber": 100,
  "status": "CONFIRMED"
}
```

---

## Prometheus Metrics

Metrics endpoint:

```
GET /api/v1/metrics
```

Implemented metrics:

### Transaction Metrics

```
transactions_created_total
transactions_confirmed_total
transactions_failed_total
transaction_confirmation_duration_seconds
```

### Blockchain RPC Metrics

```
blockchain_rpc_requests_total
blockchain_rpc_failures_total
blockchain_rpc_duration_seconds
```

### Worker Metrics

```
worker_cycles_total
worker_failures_total
worker_duration_seconds
event_listener_cycles_total
```

---

# Testing

The project maintains comprehensive automated coverage.

Current status:

```
Test Files: 37 passed
Tests: 134 passed
```

Testing includes:

## Unit Tests

* Services
* Repositories
* Validators
* Authentication logic
* Business workflows

## Integration Tests

* Blockchain transaction lifecycle
* Smart contract interaction
* Event indexing
* Confirmation processing

## Observability Tests

* Metric registration
* RPC instrumentation
* Worker instrumentation

---

# Development Setup

## Requirements

* Node.js 23+
* PostgreSQL
* Docker
* Anvil / Hardhat

---

## Install Dependencies

```bash
npm install
```

---

## Environment Setup

Create:

```
.env
```

Configure:

```
DATABASE_URL=
RPC_URL=
DEPLOYER_PRIVATE_KEY=
JWT_SECRET=
```

---

## Database Migration

Run:

```bash
npx prisma migrate dev
```

---

## Start Blockchain

Start Anvil:

```bash
anvil
```

---

## Start Application

Development mode:

```bash
npm run dev
```

---

# Quality Checks

Run:

## Tests

```bash
npm test
```

## Lint

```bash
npm run lint
```

## Type Checking

```bash
npm run typecheck
```

---

# Project Structure

```
src
├── api
│   ├── routes
│   └── middleware
│
├── auth
│
├── blockchain
│   └── rpc.instrumentation.ts
│
├── observability
│   ├── logger.ts
│   ├── metrics.ts
│   ├── rpc.metrics.ts
│   ├── transaction.metrics.ts
│   └── worker.metrics.ts
│
├── repositories
│
├── services
│
├── workers
│
└── contracts
```

---

# Engineering Principles

The project follows production backend engineering practices:

* Domain-driven service separation
* Repository abstraction
* Idempotent event processing
* Explicit transaction lifecycle states
* Structured operational logging
* Metrics-first observability
* Automated regression testing
* Clean dependency boundaries

---

# Future Roadmap

Planned improvements:

* Frontend dashboard
* Blockchain transaction explorer UI
* Distributed tracing integration
* Docker production deployment
* Kubernetes deployment manifests
* Cloud monitoring integration
* Advanced retry and recovery strategies

---

# License

MIT License
