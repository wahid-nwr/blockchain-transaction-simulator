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

Required configuration:

```env
NODE_ENV=production

DATABASE_URL=

RPC_URL=

JWT_SECRET=

DEPLOYER_PRIVATE_KEY=
```

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
