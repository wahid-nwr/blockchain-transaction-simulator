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
* Distributed tracing via OpenTelemetry (OTLP export; see ADR-008)

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

# HTTP Metrics

Location:

```text
src/observability/http.metrics.ts
```

Added alongside the SLO/alerting work in `docs/slo.md` — previously there
was no metric answering "is the API itself fast and available" at all;
every other metric measures something downstream (RPC, workers, transaction
lifecycle).

```text
http_requests_total{method, route, status_code}
http_request_duration_seconds{method, route, status_code}
```

Labeled by route **pattern** (e.g. `/api/v1/transactions/:id`), never the
raw request URL — using the raw URL would make cardinality unbounded (one
series per id ever requested).

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

```text
worker_cycles_total{worker_name}
worker_failures_total{worker_name}
worker_duration_seconds{worker_name}
worker_ready{worker_name}
confirmation_worker_pending_transactions
```

`worker_cycles_total`/`worker_failures_total`/`worker_duration_seconds` are
wired into `ExpirationScheduler` and `SubmissionRecoveryScheduler` — every
lease-acquired run is one cycle, counted whether it succeeds or fails, so
`worker_failures_total / worker_cycles_total` is a true failure ratio (see
`monitoring/recording-rules.yml`'s `worker_name:worker_failures:ratio5m`).
`confirmation_worker_pending_transactions` is sampled on a 15s interval by
`PendingTransactionsSampler` — see the important caveat about what this
metric does and doesn't mean in `docs/slo.md`'s "Backlog" section and
`docs/runbooks/confirmation-worker-lag.md`.

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

These are now real, evaluated rules rather than illustrative examples — see
`monitoring/alert-rules.yml` for the full set (11 alerts across API, RPC,
confirmation-worker, event-listener, and deployment health) and
`docs/slo.md` for the objective each is measuring against.

## Transaction Failure Rate

```promql
job:transactions_reverted:ratio15m
```

Alert: `TransactionRevertRateHigh` (`monitoring/alert-rules.yml`)

---

## RPC Provider Health

```promql
job:blockchain_rpc_requests:error_ratio5m
```

Alerts: `RPCHighErrorRate`, `RPCProviderDown` (`monitoring/alert-rules.yml`)

---

## Confirmation Latency

```promql
job:transaction_confirmation_duration_seconds:p95_15m
```

Alert: `ConfirmationLatencyHigh` (`monitoring/alert-rules.yml`)

If you're actually investigating a slow or backed-up confirmation worker,
start with `docs/runbooks/confirmation-worker-lag.md` rather than this
list — it walks through diagnosis, not just which metric to look at.

---

# Future Improvements

Planned enhancements:

## Distributed Tracing

Implemented — see ADR-008 (`docs/decisions/008-tracing.md`) for the design,
`src/observability/tracing.ts` for the Span implementation, and
`src/observability/otel-preload.ts` for SDK bootstrap.

Remaining:

* Prisma query spans (requires opting into Prisma's `tracing` preview
  feature — deliberately out of scope for the initial pass, see ADR-008)
* Trace-log correlation: `getActiveTraceContext()` exists but isn't wired
  into the Pino log format yet

---

## Dashboards

Potential dashboards:

* Transaction throughput
* Confirmation latency
* RPC performance
* Worker health

---

## Alerting

Implemented — see `monitoring/alert-rules.yml` and `docs/slo.md` for the
SLOs each alert is built against.

Remaining:

* Alertmanager routing to a real notification channel (PagerDuty, Slack,
  ...) — the alert rules exist and evaluate in Prometheus, but nothing is
  currently wired to page anyone. `docker-compose.yml` runs Prometheus
  alone, without an Alertmanager container.

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