# Testing Strategy

## Overview

The Blockchain Transaction Simulator follows a comprehensive automated testing strategy designed to validate:

* Business logic correctness
* Database behavior
* API contracts
* Blockchain integration
* Background processing
* Observability components

The test strategy combines:

* Unit testing
* Integration testing
* Blockchain lifecycle testing
* API testing
* Infrastructure testing

The goal is to provide confidence that the system behaves correctly under production-like workflows.

---

# Testing Stack

The project uses:

| Tool       | Purpose                   |
| ---------- | ------------------------- |
| Vitest     | Test framework            |
| Prisma     | Database testing          |
| PostgreSQL | Persistence validation    |
| Anvil      | Local Ethereum blockchain |
| Hardhat    | Smart contract tooling    |
| viem       | Blockchain client testing |

---

# Current Test Status

Current quality status:

```text
Test Files: 37 passed
Tests: 134 passed

Lint: Passing
Typecheck: Passing
```

The test suite runs automatically through:

```bash
npm test
```

---

# Test Architecture

The test structure mirrors the application architecture.

```text
test
|
+-- api
|   |
|   +-- Authentication API
|   +-- Transaction API
|   +-- Token API
|
+-- services
|   |
|   +-- Transaction Service
|   +-- Transfer Service
|   +-- Ledger Service
|
+-- repositories
|   |
|   +-- Prisma repository tests
|
+-- workers
|   |
|   +-- Confirmation Worker
|   +-- Event Listener Worker
|
+-- observability
|   |
|   +-- Metrics tests
|   +-- RPC instrumentation tests
|
+-- integration
    |
    +-- Blockchain lifecycle tests
```

---

# Unit Testing

Unit tests validate individual components in isolation.

Covered components:

* Services
* Repositories
* Validators
* Authentication modules
* Blockchain utilities
* Metrics instrumentation

---

# Service Tests

Location:

```text
test/services
```

Services tested include:

## Transaction Service

Validates:

* Transaction creation
* State management
* Business rules

---

## Transfer Service

Validates:

* Blockchain transfer preparation
* Contract interaction
* Transaction submission

---

## Ledger Service

Validates:

* Transaction persistence
* Hash attachment
* Lifecycle updates

The ledger abstraction remains independently testable.

---

## Balance Sync Service

Validates:

* Blockchain balance retrieval
* Snapshot creation
* Balance persistence

---

# Repository Tests

Location:

```text
test/repositories
```

Repositories are tested against PostgreSQL.

Covered areas:

* CRUD operations
* Relationship handling
* Query correctness
* Transaction persistence

Example:

```text
TransactionRepository

create()
findPending()
attachHash()
confirm()
fail()
```

---

# API Testing

Location:

```text
test/api
```

API tests validate the complete HTTP layer.

Covered APIs:

* Authentication
* Tenant management
* Wallet management
* Token management
* Transaction management
* Metrics endpoint

---

# API Testing Flow

Example transaction API flow:

```text
HTTP Request

      |
      v

Fastify Route

      |
      v

Validation

      |
      v

Service Layer

      |
      v

Repository Layer

      |
      v

HTTP Response
```

---

# Blockchain Integration Testing

Blockchain behavior is tested using:

* Anvil local blockchain
* Hardhat contracts
* viem clients

The tests simulate:

* Smart contract deployment
* Token transfers
* Transaction submission
* Receipt confirmation
* Event processing

---

# Blockchain Lifecycle Tests

Location:

```text
test/integration
```

The lifecycle test validates the complete workflow:

```text
Create Transaction

        |
        v

Submit Blockchain Transaction

        |
        v

Receive Transaction Hash

        |
        v

Confirmation Worker

        |
        v

Transaction Confirmed

        |
        v

Transfer Event Indexed

        |
        v

Balance Updated
```

---

# Smart Contract Testing

The project uses a local ERC20-compatible contract.

Test coverage includes:

* Contract deployment
* Token minting
* Token transfer
* Transfer event emission

---

# Worker Testing

Location:

```text
test/workers
```

Background workers are tested independently.

---

# Confirmation Worker Tests

Validates:

* Pending transaction processing
* Receipt retrieval
* Successful confirmation
* Failed confirmation
* Metrics recording
* Lifecycle logging

Example flow:

```text
Pending Transaction

        |
        v

Mock Blockchain Receipt

        |
        v

Confirm Transaction

        |
        v

Record Metrics
```

---

# Event Listener Worker Tests

Validates:

* Blockchain event retrieval
* Event parsing
* Duplicate protection
* Transfer persistence

---

# Observability Testing

Location:

```text
test/observability
```

Observability components are tested separately.

---

# Metrics Registration Tests

Validates:

* Metrics are created correctly
* Registry behavior
* Duplicate registration protection

Covered metrics:

```text
transactions_created_total

transactions_confirmed_total

transactions_failed_total

blockchain_rpc_requests_total

event_listener_cycles_total
```

---

# RPC Instrumentation Tests

Validates:

## Successful RPC Calls

Example:

```text
RPC call

    |
    v

instrumentRpc()

    |
    v

Success Metric Increment
```

---

## Failed RPC Calls

Validates:

* Failure counter increment
* Error propagation
* Duration recording

---

# Test Isolation

Tests use isolated environments.

Configuration:

```text
.env.test
```

The test environment provides:

* Separate database configuration
* Test-specific settings
* Controlled blockchain environment

---

# Mocking Strategy

External dependencies are mocked where appropriate.

Examples:

## Unit Tests

Mock:

* Blockchain clients
* Repository dependencies
* External services

Purpose:

* Faster execution
* Deterministic behavior

---

## Integration Tests

Use real components:

* PostgreSQL
* Anvil blockchain
* Smart contracts

Purpose:

* Validate real system behavior

---

# Database Testing Strategy

Database tests validate:

* Prisma schema behavior
* Relationships
* Constraints
* Persistence lifecycle

The test database uses migrations to ensure schema compatibility.

---

# Continuous Integration

Recommended CI pipeline:

```text
Pull Request

      |
      v

Install Dependencies

      |
      v

Database Migration

      |
      v

Run Tests

      |
      v

Run Typecheck

      |
      v

Run Lint

      |
      v

Build Application
```

---

# Quality Gates

A change should not be merged unless:

```text
Tests        ✅

Lint         ✅

Typecheck    ✅

Build        ✅
```

---

# Testing Principles

## Test Business Behavior

Tests focus on observable behavior rather than implementation details.

---

## Keep Unit Tests Fast

External systems are mocked unless integration behavior is required.

---

## Validate Production Flows

Critical workflows have integration coverage:

* Transaction lifecycle
* Blockchain confirmation
* Event indexing

---

## Prevent Regression

Every production issue should result in:

* A regression test
* Improved observability
* Updated documentation

---

# Future Testing Improvements

Planned improvements:

## End-to-End Testing

Add browser-based validation when the frontend dashboard is introduced.

---

## Load Testing

Evaluate:

* Transaction throughput
* Worker scalability
* RPC performance

Potential tools:

* k6
* Artillery

---

## Chaos Testing

Validate resilience against:

* RPC failures
* Database interruptions
* Worker crashes

---

## Contract Testing

Add automated smart contract compatibility tests for multiple blockchain networks.
