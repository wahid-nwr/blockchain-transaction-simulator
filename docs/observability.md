# Observability Architecture

## Overview

The Blockchain Transaction Simulator implements production-style observability to provide visibility into:

* Application behavior
* Transaction lifecycle
* Blockchain communication
* Background worker execution
* System performance
* Operational failures

The observability design follows three core pillars:

```text
                Observability

        +-------------+-------------+
        |             |             |
        v             v             v

    Logging       Metrics       Tracing
```

Implemented components:

* Structured logging with Pino
* Request correlation IDs
* Prometheus metrics
* RPC instrumentation
* Worker instrumentation
* Transaction lifecycle logging
* OpenTelemetry-ready tracing foundation

---

# Architecture

Observability is initialized during application startup.

```text
Application Startup

        |
        v

observability/bootstrap.ts

        |
        +----------------+
        |                |
        v                v

    Logger           Metrics Registry

                         |
             +-----------+-----------+
             |           |           |
             v           v           v

        Transaction     RPC       Worker
         Metrics     Metrics     Metrics

                         |
                         v

                 /api/v1/metrics

                         |
                         v

                    Prometheus
```

---

# Structured Logging

## Logging Framework

The project uses:

* Pino
* JSON structured logs
* Context-aware logging

Location:

```text
src/observability/logger.ts
```

---

# Log Structure

Logs contain operational context.

Example:

```json
{
  "level": 30,
  "service": "blockchain-transaction-simulator",
  "environment": "production",
  "operation": "transaction.confirmed",
  "transactionId": "tx-123",
  "txHash": "0xabc123",
  "blockNumber": 100,
  "status": "CONFIRMED"
}
```

---

# Request Correlation

Each API request receives a correlation identifier.

Purpose:

* Trace requests across services
* Connect API logs with transaction logs
* Improve production debugging

Example:

```json
{
  "requestId": "req-abc123",
  "operation": "transaction.create"
}
```

---

# Transaction Lifecycle Logging

Transaction processing emits structured lifecycle events.

## Transaction Created

```text
transaction.created
```

Contains:

* Transaction ID
* Tenant ID
* Token ID
* Amount

---

## Blockchain Submission

```text
transaction.submitted
```

Contains:

* Transaction ID
* Blockchain hash
* Network information

---

## Confirmation Started

```text
transaction.confirmation.started
```

Contains:

* Transaction ID
* Transaction hash
* Worker context

---

## Transaction Confirmed

```text
transaction.confirmed
```

Contains:

* Transaction ID
* Block number
* Gas usage
* Duration

---

## Transaction Failed

```text
transaction.failed
```

Contains:

* Transaction ID
* Failure reason
* Error context

---

# Prometheus Metrics

## Metrics Endpoint

Metrics are exposed through:

```http
GET /api/v1/metrics
```

The endpoint returns Prometheus-compatible metrics.

Example:

```text
# HELP blockchain_rpc_requests_total Total blockchain RPC requests
# TYPE blockchain_rpc_requests_total counter
```

---

# Metrics Architecture

```text
Application Component

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

Prometheus Scraper
```

---

# Transaction Metrics

Location:

```text
src/observability/transaction.metrics.ts
```

---

## transactions_created_total

Type:

```text
Counter
```

Description:

Total number of transactions created.

Example:

```text
transactions_created_total 250
```

---

## transactions_confirmed_total

Type:

```text
Counter
```

Description:

Total successfully confirmed blockchain transactions.

---

## transactions_failed_total

Type:

```text
Counter
```

Description:

Total failed transactions.

---

## transaction_confirmation_duration_seconds

Type:

```text
Histogram
```

Description:

Time required for blockchain confirmation.

Used for:

* Performance analysis
* SLA monitoring
* Alerting

---

# Blockchain RPC Metrics

Location:

```text
src/observability/rpc.metrics.ts
```

RPC communication is instrumented through:

```text
src/blockchain/rpc.instrumentation.ts
```

---

# RPC Request Counter

Metric:

```text
blockchain_rpc_requests_total
```

Labels:

```text
method
status
```

Example:

```text
blockchain_rpc_requests_total{
  method="getTransactionReceipt",
  status="success"
}
```

---

# RPC Failure Counter

Metric:

```text
blockchain_rpc_failures_total
```

Tracks:

* RPC errors
* Provider failures
* Communication problems

Example:

```text
blockchain_rpc_failures_total{
  method="getTransactionReceipt",
  status="error"
}
```

---

# RPC Duration Histogram

Metric:

```text
blockchain_rpc_duration_seconds
```

Tracks RPC latency.

Example:

```text
blockchain_rpc_duration_seconds_bucket
```

Used for:

* Latency monitoring
* Provider performance analysis

---

# Worker Metrics

Location:

```text
src/observability/worker.metrics.ts
```

Workers are monitored independently.

Tracked information:

* Worker execution count
* Worker failures
* Execution duration

---

# Event Listener Metrics

The blockchain event listener exposes:

```text
event_listener_cycles_total
```

Purpose:

Measure:

* Event polling activity
* Listener health
* Blockchain synchronization progress

---

# RPC Instrumentation Flow

RPC calls are wrapped using:

```text
instrumentRpc()
```

Flow:

```text
Blockchain Service

        |
        v

instrumentRpc()

        |
        +----------------+
        |                |
        v                v

   Execute RPC       Capture Metrics

        |
        v

 Return Result
```

Captured information:

* RPC method
* Success/failure status
* Duration

---

# Worker Observability

Background workers include execution context.

Example:

```json
{
  "operation": "worker.cycle.completed",
  "worker": "confirmation-worker",
  "cycleId": "abc123",
  "durationMs": 250
}
```

This allows operators to identify:

* Slow cycles
* Worker failures
* Processing delays

---

# Error Handling and Metrics Safety

Metric recording is isolated from business execution.

If metric collection fails:

```text
Application Operation

        |
        v

Metric Update

        |
        +---- Failure

        |
        v

Business Flow Continues
```

This prevents observability failures from affecting transaction processing.

---

# Testing Observability

Observability components have dedicated tests.

Covered areas:

## Metric Registration

Validates:

* Metrics are registered
* Duplicate registration is prevented

---

## RPC Instrumentation

Validates:

* Successful RPC calls
* Failed RPC calls
* Duration recording

---

## Worker Metrics

Validates:

* Worker lifecycle metrics
* Confirmation processing metrics

---

# Production Monitoring Examples

## Transaction Failure Rate

Monitor:

```text
transactions_failed_total
```

Alert example:

```text
High transaction failure rate detected
```

---

## RPC Provider Health

Monitor:

```text
blockchain_rpc_failures_total
```

Alert example:

```text
RPC provider errors increasing
```

---

## Confirmation Latency

Monitor:

```text
transaction_confirmation_duration_seconds
```

Alert example:

```text
Transaction confirmation latency above threshold
```

---

# Future Improvements

Planned enhancements:

## Distributed Tracing

Integration with:

* OpenTelemetry
* Jaeger
* Grafana Tempo

---

## Dashboards

Potential dashboards:

* Transaction throughput
* Confirmation latency
* RPC performance
* Worker health

---

## Alerting

Future integration:

* Prometheus AlertManager
* PagerDuty
* Cloud monitoring platforms

---

# Design Principles

The observability system follows these principles:

## Low Coupling

Business logic should not depend on observability internals.

---

## Production Visibility

Every important workflow emits:

* Logs
* Metrics
* Context

---

## Failure Isolation

Monitoring failures must never stop transaction processing.

---

## Operational Readiness

The system is designed to support:

* Debugging
* Performance analysis
* Production monitoring
* Incident response

```
```
