# Blockchain Transaction Simulator

A production-oriented blockchain transaction processing platform built with **Node.js, TypeScript, Fastify, PostgreSQL, Prisma, and viem**.

The project simulates a real-world blockchain transaction infrastructure with:

* Multi-tenant transaction processing
* Blockchain transaction lifecycle management
* Event-driven blockchain indexing
* Background confirmation workers
* Balance synchronization
* Production-grade observability
* Containerized deployment architecture
* Comprehensive automated testing

The goal is to model how modern backend systems interact with blockchain networks while applying enterprise engineering practices such as separation of concerns, idempotency, structured logging, metrics, resilience patterns, and test-driven development.

---

# Architecture Overview

The system is designed around clear separation between API, domain logic, persistence, blockchain integration, background processing, and observability.

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

                                  Worker Services

                                           |
                    +----------------------+----------------+
                    |                                       |
                    v                                       v

          Confirmation Worker                    Event Listener

                    |
                    v

          Balance Synchronization
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
* AsyncLocalStorage context propagation
* Request correlation IDs
* RPC instrumentation
* Worker lifecycle metrics

## Deployment

* Docker
* Docker Compose
* Production-style container lifecycle
* Prometheus monitoring

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
* Transaction lifecycle metrics

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

The observability architecture uses:

* AsyncLocalStorage context propagation
* Context-aware structured logging
* Correlation IDs
* Metrics instrumentation
* Worker lifecycle tracking
* RPC resilience monitoring

---

## Structured Logging

Implemented with Pino.

Example:

```json
{
  "service": "blockchain-transaction-simulator",
  "operation": "transaction.confirmed",
  "transactionId": "tx-123",
  "txHash": "0xabc",
  "blockNumber": 100,
  "status": "CONFIRMED"
}
```

---

## Prometheus Metrics

API metrics endpoint:

```
GET /api/v1/metrics
```

Worker metrics endpoint:

```
GET /metrics
```

Implemented metrics include:

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
blockchain_rpc_retries_total
```

### Worker Metrics

```
worker_cycles_total
worker_failures_total
worker_duration_seconds
worker_ready
pending_transactions
event_listener_cycles_total
```

---

# RPC Resilience

Blockchain communication includes production-style resilience features:

Implemented:

* RPC timeout handling
* Retry policies
* Exponential backoff
* Error classification
* Failure metrics
* Structured retry logging

RPC execution is centralized through:

```
src/blockchain/rpc.executor.ts
```

---

# Testing

The project maintains comprehensive automated coverage.

Current status:

```
Test Files: 37 passed
Tests: 134 passed
```

Quality gates:

```bash
npm test

npm run lint

npm run typecheck
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

Development:

```bash
npx prisma migrate dev
```

Production:

```bash
npx prisma migrate deploy
```

---

## Start Blockchain

Start Anvil:

```bash
anvil
```

---

## Start Application

Development:

```bash
npm run api:dev
```

Worker:

```bash
npm run worker:event-listener
```

---

# Docker Deployment

The project uses a single immutable Docker image.

The same image runs:

* API container
* Worker container
* Migration job

Example:

```
blockchain-transaction-simulator:<version>

        |
        +-- API
        |
        +-- Worker
        |
        +-- Migration
```

---

## Local Container Deployment

Start:

```bash
docker compose up --build
```

Provides:

* PostgreSQL
* API service
* Worker service
* Prometheus

---

## Production Deployment

Production deployment uses:

```bash
docker compose \
  --env-file .env.production \
  -f docker-compose.prod.yml \
  up -d --build
```

Deployment lifecycle:

```
PostgreSQL

      |
      v

Migration Job

      |
      v

API Container

      |
      v

Worker Container

      |
      v

Health Checks
```

---

# Health Checks

API health endpoint:

```
GET /api/v1/health
```

API metrics:

```
GET /api/v1/metrics
```

Worker metrics:

```
GET /metrics
```

Container health checks verify:

* Service availability
* Database connectivity
* Runtime readiness

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
│   ├── rpc.executor.ts
│   ├── rpc.instrumentation.ts
│   ├── rpc.errors.ts
│   └── rpc.classifier.ts
│
├── observability
│   ├── logger.ts
│   ├── metrics.ts
│   ├── bootstrap.ts
│   ├── context.ts
│   ├── tracing.ts
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
* Ledger abstraction
* Idempotent event processing
* Explicit transaction lifecycle states
* Structured operational logging
* Metrics-first observability
* RPC resilience patterns
* Automated regression testing
* Clean dependency boundaries

---

# Production Readiness Status

Completed:

✅ Transaction lifecycle
✅ Blockchain integration
✅ Event-driven indexing
✅ Worker hardening
✅ RPC resilience
✅ Production observability
✅ Docker deployment
✅ Health checks
✅ Prometheus monitoring
✅ Automated quality gates

---

# Future Roadmap

Planned improvements:

* Kubernetes manifests
* Helm charts
* Cloud deployment automation
* Horizontal worker scaling
* Managed Prometheus integration
* Full OpenTelemetry tracing
* Blue/green deployments
* Blockchain explorer dashboard

---

# License

MIT License
