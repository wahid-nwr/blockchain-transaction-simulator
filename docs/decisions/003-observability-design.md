# ADR 003: Production Observability Design

## Status

Accepted

## Date

2026-07-29

---

# Context

Blockchain transaction processing involves multiple asynchronous components:

* API requests
* Blockchain RPC calls
* Background workers
* Event listeners

Without observability, diagnosing failures becomes difficult.

Example:

```text
Transaction Failed

        ?

API problem?

RPC problem?

Worker problem?

Blockchain problem?
```

---

# Decision

Implement observability using three pillars:

```text
Observability

 +------------+-------------+

 Logging   Metrics   Tracing
```

---

# Logging

Use structured JSON logging.

Technology:

* Pino

Logs contain:

* Operation name
* Transaction context
* Request correlation ID
* Worker context

Example:

```json
{
  "operation": "transaction.confirmed",
  "transactionId": "tx-123",
  "status": "CONFIRMED"
}
```

---

# Metrics

Expose Prometheus-compatible metrics.

Implemented categories:

## Transaction Metrics

Tracks:

* Created transactions
* Confirmed transactions
* Failed transactions
* Confirmation duration

---

## RPC Metrics

Tracks:

* Blockchain calls
* RPC failures
* RPC latency

---

## Worker Metrics

Tracks:

* Worker cycles
* Worker failures
* Processing duration

---

# Consequences

## Positive

### Faster Debugging

Operators can identify failure boundaries quickly.

---

### Production Visibility

The system exposes operational health.

---

### Future Monitoring

Compatible with:

* Prometheus
* Grafana
* OpenTelemetry

---

## Negative

### Additional Code

Instrumentation increases implementation complexity.

---

### Metric Management

Requires:

* Naming conventions
* Cardinality control

---

# Alternatives Considered

## Logging Only

Rejected because:

* Logs are difficult for trend analysis

---

## Metrics Only

Rejected because:

* Metrics lack transaction context

---

# Future Improvements

Add:

* Distributed tracing
* Grafana dashboards
* Alert rules
* OpenTelemetry collectors
