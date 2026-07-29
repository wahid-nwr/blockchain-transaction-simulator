# System Architecture

## Overview

The Blockchain Transaction Simulator is designed as a production-oriented backend platform that models how enterprise systems interact with blockchain networks.

The architecture separates responsibilities across:

* API layer
* Authentication and authorization
* Domain services
* Ledger abstraction
* Persistence layer
* Blockchain integration
* Background workers
* Observability infrastructure

The primary design goal is to keep blockchain-specific concerns isolated while maintaining reliable transaction processing, auditability, and operational visibility.

---

# High-Level Architecture

```text
                         Client Applications
                                |
                                |
                                v
                         Fastify REST API
                                |
              +-----------------+-----------------+
              |                                   |
              v                                   v
        Authentication                    Request Validation
              |
              |
              v
        Application Services
              |
      +-------+----------------+
      |                        |
      v                        v
 Ledger Services          Domain Services
      |
      |
      v
 Repository Layer
      |
      |
      v
 PostgreSQL Database


 Blockchain Integration Layer
              |
              |
              v
       Ethereum Compatible Chain
              |
              |
              v
       Background Workers
              |
      +-------+--------+
      |                |
      v                v
 Confirmation      Event Listener
 Worker            Worker
```

---

# Architectural Layers

## API Layer

Location:

```text
src/api
```

Responsibilities:

* HTTP routing
* Request handling
* Authentication middleware
* Input validation
* Response formatting
* Error handling

The API layer does not contain business logic.

Example flow:

```text
HTTP Request
      |
      v
Route Handler
      |
      v
Service Layer
      |
      v
Repository Layer
```

This keeps API concerns separated from domain behavior.

---

# Authentication Layer

Location:

```text
src/auth
```

Responsibilities:

* User authentication
* Password management
* JWT generation
* Refresh token lifecycle
* API key validation

Security boundaries are enforced before requests reach business services.

---

# Service Layer

Location:

```text
src/services
```

The service layer contains business workflows.

Major services include:

## Transaction Service

Responsible for:

* Creating transactions
* Validating transaction requests
* Managing transaction state

---

## Transfer Service

Responsible for:

* Preparing blockchain transfers
* Interacting with wallet clients
* Submitting blockchain transactions

---

## Ledger Service

Responsible for:

* Maintaining transaction records
* Persisting blockchain lifecycle information
* Providing an abstraction over transaction storage

The ledger abstraction prevents blockchain details from leaking into the rest of the application.

---

## Balance Service

Responsible for:

* Managing balance information
* Providing balance queries
* Coordinating balance synchronization

---

# Repository Layer

Location:

```text
src/repositories
```

Responsibilities:

* Database access
* Query abstraction
* Persistence operations

Repositories isolate Prisma/database concerns from business logic.

Examples:

```text
TransactionRepository

TokenRepository

WalletRepository

TransferRepository

BalanceSnapshotRepository
```

---

# Database Architecture

The system uses:

* PostgreSQL
* Prisma ORM

Core entities:

```text
Tenant
 |
 +-- User
 |
 +-- Wallet
 |
 +-- Token
 |
 +-- Transaction
 |
 +-- TokenTransfer
 |
 +-- BalanceSnapshot
```

---

# Blockchain Integration Layer

Location:

```text
src/blockchain
```

The blockchain layer encapsulates:

* RPC communication
* Wallet signing
* Smart contract interaction
* Transaction receipt retrieval
* RPC observability

Technology:

* viem
* Ethereum-compatible RPC

---

# Transaction Processing Flow

A transaction follows this lifecycle:

```text
Client Request

      |
      v

Transaction Service

      |
      v

Create Database Transaction
(PENDING)

      |
      v

Blockchain Submission

      |
      v

Persist Transaction Hash

      |
      v

Confirmation Worker

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

---

# Background Workers

Location:

```text
src/workers
```

Workers provide asynchronous processing.

## Confirmation Worker

Responsibilities:

* Poll pending blockchain transactions
* Retrieve transaction receipts
* Update transaction status
* Record block number
* Record gas usage

Flow:

```text
Pending Transaction

        |
        v

getTransactionReceipt()

        |
        |
 +------+------+
 |             |
 v             v

Success       Failure

 |             |

CONFIRMED    FAILED
```

---

## Event Listener Worker

Responsibilities:

* Read blockchain events
* Process ERC20 Transfer events
* Persist token transfers
* Prevent duplicate processing

The listener follows an event-driven synchronization model.

---

# Event-Driven Design

Blockchain state is treated as an external source of truth.

Instead of relying only on database state:

```text
Blockchain Event

        |
        v

Event Listener

        |
        v

Database Projection

        |
        v

Application Queries
```

Benefits:

* Replay capability
* Auditability
* Idempotent processing
* Recovery after failures

---

# Idempotency Design

Blockchain systems require protection against duplicate processing.

Implemented protections:

## Transaction Protection

Transactions are uniquely tracked using:

* Internal transaction ID
* Blockchain transaction hash

---

## Event Protection

Token transfer events use:

* Blockchain transaction hash
* Log index
* Event cursor tracking

This prevents duplicate database records when events are replayed.

---

# Observability Architecture

Location:

```text
src/observability
```

Observability is built into the application lifecycle.

Components:

```text
Logger
 |
 +-- Structured JSON logs
 +-- Correlation IDs
 +-- Transaction context


Metrics
 |
 +-- Prometheus registry
 +-- Transaction metrics
 +-- RPC metrics
 +-- Worker metrics


Tracing
 |
 +-- Distributed tracing foundation
```

---

# Metrics Flow

```text
Application Code

      |
      v

Metric Instrumentation

      |
      v

Prometheus Registry

      |
      v

/api/v1/metrics

      |
      v

Prometheus Server
```

---

# Error Handling Architecture

The system uses centralized error handling.

Flow:

```text
Service Error

      |
      v

Application Error

      |
      v

Fastify Error Handler

      |
      v

Standard API Response
```

Benefits:

* Consistent client responses
* Better debugging
* Centralized logging

---

# Design Principles

## Separation of Concerns

Each layer has a clear responsibility.

---

## Dependency Isolation

Business logic does not directly depend on:

* HTTP
* Prisma
* Blockchain RPC

---

## Testability

Components are designed for isolated testing through:

* Dependency injection
* Mocked external systems
* Repository abstraction

---

## Production Readiness

The architecture includes:

* Structured logging
* Metrics
* Background processing
* Failure handling
* Idempotency
* Automated testing

---

# Future Architecture Evolution

Planned extensions:

```text
Current System

       |
       v

Frontend Dashboard

       |
       v

API Gateway

       |
       v

Distributed Deployment

       |
       +----------------+
       |                |
       v                v

 Kubernetes       Cloud Monitoring
```

Future improvements may include:

* OpenTelemetry tracing
* Distributed worker execution
* Message queue integration
* Cloud-native deployment
* Horizontal scaling

```
```
