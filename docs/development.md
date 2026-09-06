# Development Guide

## Overview

This guide explains how to set up, run, test, and debug the Blockchain Transaction Simulator locally.

The development environment is designed to provide a production-like workflow using:

* Node.js
* TypeScript
* PostgreSQL
* Prisma ORM
* Anvil local blockchain
* Hardhat smart contracts
* Vitest testing
* Prometheus-compatible metrics

---

# Prerequisites

Before starting development, install:

## Node.js

Recommended:

```text
Node.js 24+
```

Verify:

```bash
node --version
```

---

## PostgreSQL

Required for:

* Application database
* Test database

Verify:

```bash
psql --version
```

---

## Docker

Optional but recommended for local infrastructure.

Verify:

```bash
docker --version
```

---

## Anvil

Anvil provides a local Ethereum-compatible blockchain.

Install:

```bash
foundryup
```

Verify:

```bash
anvil --version
```

---

# Repository Setup

Clone the repository:

```bash
git clone <repository-url>
```

Navigate:

```bash
cd blockchain-transaction-simulator
```

Install dependencies:

```bash
npm install
```

---

# Environment Configuration

The application uses environment-based configuration.

Create:

```text
.env
```

Example:

```env
NODE_ENV=development

DATABASE_URL=postgresql://user:password@localhost:5432/blockchain_simulator

RPC_URL=http://127.0.0.1:8545

DEPLOYER_PRIVATE_KEY=0x...

JWT_SECRET=change-me
```

---

# Test Environment

Tests use a separate environment.

Create:

```text
.env.test
```

Example:

```env
NODE_ENV=test

DATABASE_URL=postgresql://user:password@localhost:5432/blockchain_simulator_test

RPC_URL=http://127.0.0.1:8545

JWT_SECRET=test-secret
```

The separation prevents tests from modifying development data.

---

# Database Setup

## Create Database

Example:

```sql
CREATE DATABASE blockchain_simulator;
CREATE DATABASE blockchain_simulator_test;
```

---

## Apply Prisma Migration

Development:

```bash
npx prisma migrate dev
```

Test:

```bash
NODE_ENV=test npx prisma migrate deploy
```

---

## Generate Prisma Client

```bash
npx prisma generate
```

---

# Running the Blockchain

Start Anvil:

```bash
anvil
```

Default RPC:

```text
http://127.0.0.1:8545
```

Anvil provides:

* Local accounts
* Private keys
* Fast block mining
* Ethereum-compatible RPC

---

# Smart Contract Deployment

The project uses Solidity contracts for blockchain testing.

Typical flow:

```text
Start Anvil

      |
      v

Deploy Contract

      |
      v

Store Contract Address

      |
      v

Run Application
```

Deployment scripts are used to:

* Deploy ERC20 token contracts
* Initialize test blockchain state
* Provide contract addresses

---

# Running the Application

Development mode:

```bash
npm run dev
```

The application starts:

```text
Fastify Server

        |
        +-- REST API

        +-- Workers

        +-- Observability
```

---

# API Access

Default API:

```text
http://localhost:3000
```

Health endpoint:

```http
GET /health
```

Metrics endpoint:

```http
GET /api/v1/metrics
```

---

# API Documentation

OpenAPI documentation is available through Swagger.

Typical URL:

```text
http://localhost:3000/docs
```

The API documentation provides:

* Available endpoints
* Request schemas
* Response formats
* Authentication requirements

---

# Development Workflow

Recommended workflow:

```text
Create Feature

      |
      v

Add Tests

      |
      v

Implement Change

      |
      v

Run Unit Tests

      |
      v

Run Integration Tests

      |
      v

Lint + Typecheck

      |
      v

Commit
```

---

# Useful Commands

## Development Server

```bash
npm run dev
```

---

## Run All Tests

```bash
npm test
```

---

## Run Specific Test

Example:

```bash
npm test -- test/services/transaction.service.test.ts
```

---

## Run Tests in Watch Mode

```bash
npm test -- --watch
```

---

## Lint

```bash
npm run lint
```

---

## Type Checking

```bash
npm run typecheck
```

---

## Build

```bash
npm run build
```

---

# Debugging Workflow

## Application Logs

The application uses structured logging.

Example:

```json
{
  "operation": "transaction.confirmed",
  "transactionId": "tx-123",
  "status": "CONFIRMED"
}
```

Use logs to trace:

* API requests
* Transaction lifecycle
* Worker execution
* Blockchain communication

---

# Debugging Blockchain Transactions

When debugging blockchain issues:

Check:

## Transaction Record

Verify:

* Transaction status
* Transaction hash
* Confirmation state

---

## Blockchain Receipt

Verify:

* Receipt availability
* Block number
* Gas usage
* Execution status

---

## Worker Logs

Confirmation worker logs provide:

* Cycle ID
* Transaction ID
* RPC execution context

---

# Debugging RPC Issues

RPC calls are instrumented.

Tracked information:

* RPC method
* Success/failure
* Duration

Example metric:

```text
blockchain_rpc_requests_total
```

Use metrics to identify:

* Provider issues
* Slow responses
* Failure spikes

---

# Debugging Database Issues

Useful Prisma commands:

View schema:

```bash
npx prisma studio
```

Reset development database:

```bash
npx prisma migrate reset
```

Check migration status:

```bash
npx prisma migrate status
```

---

# Project Structure

```text
src
|
+-- api
|   |
|   +-- routes
|   +-- middleware
|
+-- auth
|
+-- blockchain
|   |
|   +-- rpc.instrumentation.ts
|
+-- contracts
|
+-- observability
|   |
|   +-- logger.ts
|   +-- metrics.ts
|   +-- bootstrap.ts
|   +-- rpc.metrics.ts
|   +-- transaction.metrics.ts
|   +-- worker.metrics.ts
|
+-- repositories
|
+-- services
|
+-- workers
```

---

# Adding a New Feature

Recommended steps:

## 1. Define Domain Behavior

Identify:

* Business rules
* State changes
* Failure scenarios

---

## 2. Add Database Changes

Update:

```text
prisma/schema.prisma
```

Create migration:

```bash
npx prisma migrate dev --name feature_name
```

---

## 3. Implement Repository

Add persistence logic.

---

## 4. Implement Service

Keep business logic outside controllers.

---

## 5. Add API Layer

Add:

* Route
* Validation schema
* Error handling

---

## 6. Add Tests

Required coverage:

* Unit tests
* Integration tests where needed

---

## 7. Add Observability

New workflows should include:

* Structured logs
* Metrics
* Error visibility

---

# Code Quality Rules

Before submitting changes:

Run:

```bash
npm test

npm run lint

npm run typecheck
```

All must pass.

---

# Common Issues

## Duplicate Prometheus Metrics

Cause:

Multiple module loads registering the same metric.

Solution:

Use the shared:

```text
observability/metrics.ts
```

registry.

---

## Database Migration Errors

Check:

```bash
npx prisma migrate status
```

Reset if required:

```bash
npx prisma migrate reset
```

---

## Blockchain RPC Failures

Verify:

* Anvil is running
* RPC_URL is correct
* Contract addresses are valid
* Private keys are configured

---

# Development Principles

The project follows:

## Test First

New behavior should have tests before production implementation.

---

## Explicit State Management

Important workflows use explicit lifecycle states.

---

## Observable by Default

Every production workflow should provide:

* Logs
* Metrics
* Debug context

---

## Small, Safe Changes

Prefer incremental changes with regression protection.

---

# Future Development Improvements

Planned improvements:

* Frontend dashboard development
* Docker Compose local environment
* CI/CD pipeline
* Production container images
* Kubernetes manifests
* Cloud deployment automation
* Load testing environment
