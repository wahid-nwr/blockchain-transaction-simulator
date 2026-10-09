# Deployment Guide

## Overview

This document describes how to deploy the Blockchain Transaction Simulator in production-like environments.

The deployment architecture is designed around:

* Containerized application services
* Single immutable application image
* External PostgreSQL database
* Ethereum-compatible blockchain RPC provider
* Independent API and worker workloads
* Dedicated database migration lifecycle
* Prometheus monitoring
* Centralized logging

The deployment model separates:

* API workload
* Background processing workload
* Database migration workload
* Persistence layer
* Blockchain communication
* Observability infrastructure

---

# Production Architecture

High-level production topology:

```text
                         Users / Clients
                              |
                              v
                         Load Balancer
                              |
                              v
                    +-------------------+
                    | Fastify API       |
                    | Container         |
                    +-------------------+
                              |
             +----------------+----------------+
             |                                 |
             v                                 v

      PostgreSQL Database              Blockchain RPC Provider


                              ^
                              |
                    +-------------------+
                    | Worker Container  |
                    |                   |
                    | Confirmation      |
                    | Event Listener    |
                    +-------------------+


Deployment lifecycle:

                    +-------------------+
                    | Migration Job     |
                    |                   |
                    | prisma migrate    |
                    +-------------------+
                              |
                              v

                    Database Schema Ready


Observability:

              API / Worker Metrics

                       |
                       v

                 Prometheus Server

                       |
                       v

                  Monitoring Stack
```

---

# Deployment Components

## Application Service

Runs:

* Fastify HTTP server
* API routes
* Authentication
* Transaction services
* Business workflows

Responsibilities:

* Accept client requests
* Validate input
* Trigger transaction workflows
* Expose metrics endpoint
* Provide health checks

The API runs independently from background processing.

---

## Worker Service

Background processing runs independently.

Workers:

```text
src/workers
```

Responsibilities:

* Blockchain confirmation polling
* Event indexing
* Balance synchronization

Separating workers from API servers provides:

* Independent scaling
* Better reliability
* Resource isolation
* Failure isolation

---

## Migration Service

Database migrations run as a separate deployment step.

Responsibilities:

* Wait for database readiness
* Apply Prisma migrations
* Exit after successful completion

The migration job does not run continuously.

Example:

```bash
npx prisma migrate deploy
```

---

# Container Deployment

The recommended production approach is container-based deployment.

Example:

```text
Docker Image

        |
        v

Container Runtime

        |
        v

Cloud / Kubernetes Environment
```

---

# Docker Image Structure

The application uses a single immutable Docker image.

The same image is used for:

* API service
* Worker service
* Database migration job

Example:

```text
blockchain-transaction-simulator:<version>

        |
        +-- API container
        |
        +-- Worker container
        |
        +-- Migration job
```

The container image contains:

```text
Application Container

 |
 +-- Node.js Runtime
 |
 +-- Compiled TypeScript output
 |
 +-- Prisma Client
 |
 +-- Smart contract artifacts
 |
 +-- Runtime dependencies
 |
 +-- Startup scripts
```

Runtime behavior is controlled by the deployment layer.

---

# Docker Compose Deployment

## Local Environment

Start the development stack:

```bash
docker compose up --build
```

Local deployment provides:

* PostgreSQL
* API service
* Worker service
* Prometheus

Development containers handle:

* Database readiness checks
* Local migration execution
* Application startup

---

## Production Environment

Production deployment uses an explicit migration lifecycle.

Build and start:

```bash
docker compose \
  --env-file .env.production \
  -f docker-compose.prod.yml \
  up -d --build
```

Deployment flow:

```text
PostgreSQL Starts

        |
        v

Database Health Check

        |
        v

Migration Job Executes

        |
        v

API Container Starts

        |
        v

Worker Container Starts

        |
        v

Health Checks Pass
```

---

# Environment Configuration

Production configuration should be provided through:

* Environment variables
* Secret management systems
* Cloud secret stores

Required configuration (see `.env.production.example`; `docker-compose.prod.yml`
refuses to render if `JWT_SECRET` or `KMS_PROVIDER` is missing):

```env
NODE_ENV=production

DATABASE_URL=

RPC_URL=

JWT_SECRET=

# "aws" in production. "local" is dev/test only: it encrypts wallet keys under
# LOCAL_KMS_MASTER_KEY, which then sits next to the ciphertext it protects.
KMS_PROVIDER=aws
AWS_REGION=
```

Optional: `PRIVATE_KEY` (operator key that signs admin mints) and the
`BALANCE_DRIFT_*` job settings (`docs/runbooks/balance-drift.md`). Redis is
provided by the compose file itself at `redis://redis:6379` and is not
published to the host.

Prometheus (`9090`) and the worker metrics port (`3001`) are bound to
`127.0.0.1` only. Reach the Prometheus UI over an SSH tunnel
(`ssh -L 9090:localhost:9090 <host>`) or a reverse proxy that adds
authentication. `./monitoring` is mounted at `/etc/prometheus/rules`; without
that mount Prometheus starts normally but evaluates no rules.

Secrets must not be stored inside:

* Source code
* Docker images
* Git repositories

---

# Database Deployment

## PostgreSQL

Production database requirements:

* Persistent storage
* Automated backups
* Connection pooling
* Monitoring

Recommended features:

* Managed PostgreSQL service
* SSL connections
* Migration automation

---

# Database Migration Strategy

Production migrations should be executed explicitly.

The migration job:

* Uses the same application image
* Waits for PostgreSQL readiness
* Executes Prisma deployment migrations
* Exits after completion

Example:

```bash
npx prisma migrate deploy
```

Avoid:

```bash
npx prisma migrate dev
```

in production environments.

API and Worker containers do not modify database schema during startup.

---

# Blockchain Configuration

The application supports Ethereum-compatible networks.

Configuration:

```env
RPC_URL=<blockchain-provider-url>
```

Possible providers:

* Self-hosted nodes
* Managed RPC providers
* Private blockchain networks

---

# Smart Contract Deployment

Contract deployment lifecycle:

```text
Build Contract

       |
       v

Deploy Contract

       |
       v

Store Contract Address

       |
       v

Configure Application

       |
       v

Enable Transactions
```

Production environments should maintain:

* Contract addresses
* Network identifiers
* Deployment metadata

## Deploying MiniUSDT to a public network

`npm run deploy` (hardhat) only works against a development node that holds unlocked accounts, as CI's Anvil does. For a public network use the signer-based script, which also works against Anvil:

```bash
npm run compile

# 1. Dry run: prints the plan and the checks, deploys nothing.
RPC_URL=<rpc> EVM_CHAIN_ID=<chain id> PRIVATE_KEY=<fresh funded key> npm run deploy:live

# 2. Deploy.
RPC_URL=<rpc> EVM_CHAIN_ID=<chain id> PRIVATE_KEY=<fresh funded key> \
  npm run deploy:live -- --yes --out deployment.json
```

For Robinhood Chain testnet that is `EVM_CHAIN_ID=46630` and `RPC_URL=https://rpc.testnet.chain.robinhood.com`.

**The account behind `PRIVATE_KEY` becomes the token owner.** Only the owner can mint, and the API signs mints with its own `PRIVATE_KEY`, so deploy with the same key you configure on the API and worker (as a secret, not in a file). Fund that address with the network's native token first, since the script refuses to run without gas.

The script refuses to deploy when:

| Condition | Why |
| --- | --- |
| The RPC serves a different chain than `EVM_CHAIN_ID` | Deploying to a network you did not intend is the costliest mistake, and it is checked first |
| The key is an Anvil/Hardhat default account (on any chain except 31337) | Those private keys are public; anyone could mint or pause the token |
| The deployer has no funds, or less than the estimated cost | Fails early with the address to fund |

Outside the local chain it only deploys with `--yes`; without it, it is a dry run. The RPC URL is printed as its origin only, because provider URLs usually embed the API key, and errors are redacted the same way.

After deploying it verifies the contract by reading it back (code present, owner is the deployer) and prints the follow-up configuration:

1. API and worker: `EVM_CHAIN_ID`, `RPC_URL`, `PRIVATE_KEY`.
2. Worker: `EVM_INDEX_START_BLOCK=<deployment block>`, so the indexer does not crawl the chain's empty history.
3. Register the token with `POST /api/v1/tokens` (ADMIN) using the printed body.

If the script times out waiting for the receipt it prints the transaction hash and does not resend; check the explorer before deploying again.

---

# Application Startup

Production startup is separated by workload.

## API Container

```text
Container Starts

        |
        v

Load Environment

        |
        v

Initialize Logger

        |
        v

Initialize Metrics

        |
        v

Connect Database

        |
        v

Start Fastify Server
```

---

## Worker Container

```text
Container Starts

        |
        v

Load Environment

        |
        v

Initialize Logger

        |
        v

Initialize Metrics

        |
        v

Start Worker Loop
```

---

# Health Checks

The API exposes:

```http
GET /api/v1/health
```

Health checks verify:

* Application availability
* Database connectivity
* Required dependencies

Container health checks are used by Docker Compose to determine service readiness.

Worker readiness is exposed through:

* Worker health endpoint
* Prometheus readiness metrics

---

# Metrics Deployment

The application exposes:

```http
GET /api/v1/metrics
```

Worker metrics are exposed separately:

```http
GET /metrics
```

Prometheus scrapes both endpoints.

Architecture:

```text
Application

     |
     v

Prometheus Metrics Endpoint

     |
     v

Prometheus Server

     |
     v

Grafana Dashboards
```

---

# Recommended Monitoring Stack

Example production stack:

```text
Application Logs
        |
        v
     Loki / ELK


Metrics
        |
        v
  Prometheus

        |
        v

    Grafana


Tracing
        |
        v

OpenTelemetry
```

---

# Logging Strategy

Production logs should be:

* Structured JSON
* Centralized
* Searchable

Recommended fields:

```json
{
  "service": "blockchain-transaction-simulator",
  "environment": "production",
  "operation": "transaction.confirmed",
  "transactionId": "tx-123"
}
```

---

# Scaling Strategy

## API Scaling

The API layer is stateless.

Multiple instances can run:

```text
              Load Balancer

                    |
        +-----------+-----------+

        v                       v

    API Instance 1          API Instance 2
```

Requirements:

* Shared database
* Shared configuration
* External session storage if required

---

## Worker Scaling

Workers require coordination.

Possible approaches:

### Single Worker Instance

Suitable for:

* Small deployments
* Low transaction volume

---

### Distributed Workers

For larger deployments:

```text
        Worker Pool

     +------+------+------+

     v      v      v

 Worker Worker Worker
```

Requires:

* Distributed locking
* Queue-based processing
* Work partitioning

---

# Reliability Considerations

## Database Failures

Handle:

* Connection retries
* Graceful shutdown
* Transaction rollback

---

## Blockchain RPC Failures

The system tracks:

```text
blockchain_rpc_failures_total
```

Recommended additions:

* Retry policies
* Provider fallback
* Circuit breakers

---

## Worker Failures

Workers support:

* Restart policies
* Graceful shutdown
* Failure metrics

---

# Security Considerations

## Secrets

Never store secrets in:

* Source code
* Docker images
* Git repositories

Use:

* Environment injection
* Secret managers

---

## Private Keys

Private keys should be handled carefully.

Recommended production options:

* Hardware security modules
* Cloud key management systems
* Dedicated signing services

---

## Database Security

Use:

* Encrypted connections
* Least privilege users
* Network restrictions

---

# CI/CD Pipeline

Recommended pipeline:

```text
Developer Push

       |
       v

CI Pipeline

       |
       +----------------+
       |                |
       v                v

 Tests             Static Checks

       |
       v

 Build Container

       |
       v

 Deploy Environment

       |
       v

 Health Verification
```

---

# Deployment Environments

Recommended environments:

```text
Development

       |

Testing

       |

Staging

       |

Production
```

Each environment should have:

* Separate database
* Separate blockchain configuration
* Separate secrets

---

# Backup Strategy

Important data:

* Transactions
* Token transfers
* Balance snapshots
* User information

Recommended:

* Automated PostgreSQL backups
* Migration history backup
* Disaster recovery testing

---

# Observability During Deployment

Before production release verify:

## Logs

Check:

* Application startup
* Worker startup
* Error reporting

---

## Metrics

Verify:

```text
blockchain_rpc_requests_total

transactions_created_total

event_listener_cycles_total
```

---

## Health

Verify:

```text
GET /api/v1/health

GET /api/v1/metrics

GET /metrics
```

---

# Rollback Strategy

A deployment should support rollback.

Rollback triggers:

* Application errors
* Database migration problems
* Blockchain integration failures

Rollback approach:

```text
Previous Container Version

          |

          v

Restore Traffic

          |

          v

Investigate Failure
```

---

# Future Deployment Improvements

Planned improvements:

* Kubernetes manifests
* Helm charts
* Automated cloud deployment
* Horizontal worker scaling
* Managed Prometheus integration
* Full OpenTelemetry deployment
* Blue/green deployments

---

# Production Readiness Checklist

Before release:

```text
Application

[ ] Environment configured
[ ] Container image built
[ ] Database migrated
[ ] API health endpoint verified
[ ] Worker health verified


Security

[ ] Secrets protected
[ ] Private keys secured


Observability

[ ] Logs available
[ ] Metrics scraped
[ ] Alerts configured
[ ] Prometheus targets healthy


Operations

[ ] Backup configured
[ ] Rollback tested
[ ] Monitoring enabled
```
