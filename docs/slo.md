# Service Level Objectives

This defines what "healthy" means for this system in numbers, not vibes —
and the exact Prometheus queries used to measure each one. Every query here
either is, or is built directly on top of, a rule in
`monitoring/recording-rules.yml`; nothing below is aspirational or
unmeasurable given what's currently instrumented.

Windows are 30-day rolling unless stated otherwise, matching common SRE
practice for error-budget tracking. This project doesn't run an error-budget
policy (no on-call rotation to gate deploys against) — these are targets and
the queries that measure them, not a burn-rate alerting system. The
`for:` durations in `monitoring/alert-rules.yml` are shorter windows (5–15m)
tuned for "notice something is currently wrong", not the 30-day objective.

---

## API

### Availability

**Objective:** 99% of requests do not return a 5xx, over 30 days.

```promql
1 - (
  sum(rate(http_requests_total{status_code=~"5.."}[30d]))
  /
  sum(rate(http_requests_total[30d]))
)
```

Recording rule (5m window, used by the `APIHighErrorRate` alert):
`job:http_requests:availability5m`

**Why 99% and not higher:** this is a demonstration system without redundant
API instances or a multi-region deployment behind it — 99% is honest for
the actual infrastructure in `docker-compose.prod.yml`, not a number picked
to look impressive. A real production deployment with multiple API replicas
behind a load balancer would target higher.

### Latency

**Objective:** p95 request latency under 1 second, over 30 days.

```promql
histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket[30d])) by (le))
```

Recording rule (5m window): `job:http_request_duration_seconds:p95_5m`

Per-route breakdown (useful when the aggregate SLO is breached and you need
to find which endpoint is responsible):

```promql
histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket[30d])) by (le, route))
```

Recording rule (5m window): `route:http_request_duration_seconds:p95_5m`

---

## Confirmation worker

This is the part of the system actually doing financial work — a slow or
stuck confirmation worker means real money movements are stalled, which is
a materially different severity than API latency.

### Confirmation latency

**Objective:** p95 time from "submitted to chain" to "confirmed" under 60
seconds, over 30 days.

```promql
histogram_quantile(0.95, sum(rate(transaction_confirmation_duration_seconds_bucket[30d])) by (le))
```

Recording rule (15m window): `job:transaction_confirmation_duration_seconds:p95_15m`

**Why 60s:** this system runs against a local Anvil chain in dev/CI, where
confirmation is near-instant, and is designed to be pointed at an EVM chain
in general. 60 seconds is a reasonable target for typical EVM block times
(12s on mainnet) plus the worker's own poll interval
(`CONFIRMATION_POLL_INTERVAL_MS`, default 5s) — not a number derived from
production traffic this system hasn't seen.

### Backlog (orphaned submissions)

**Objective:** fewer than 50 transactions sitting in PENDING (created, not
yet submitted) at any time.

```promql
confirmation_worker_pending_transactions
```

No recording rule needed — this is already a gauge, not something to
rate()/quantile over.

**Important:** despite the metric's name, this is not actually a
confirmation-worker health signal — submission (PENDING → SUBMITTED)
happens synchronously inside the API request path
(`TransferService.transfer()`), not in a background worker, and the
confirmation worker only ever processes SUBMITTED transactions. A growing
count here means API requests are failing between creating the transaction
and submitting it to chain — most likely process crashes, since a normal
thrown error is already caught and marks the transaction FAILED.

`PendingRecoveryScheduler` recovers these automatically: it looks for
independent on-chain evidence (a `TokenTransfer` row written by the event
listener) before deciding whether to adopt the transaction as `SUBMITTED`
or mark it `FAILED`, specifically so a crash between broadcasting a
transfer and persisting its hash doesn't get silently misrecorded as
failed when it actually succeeded on-chain. See
`src/workers/pending-recovery.processor.ts` and
`docs/runbooks/confirmation-worker-lag.md` for the full design and what to
check if the backlog persists past `PENDING_RECOVERY_FAIL_AFTER_MS`
(default 15 minutes) despite the scheduler running. This is the primary
signal for the `PendingTransactionsBacklogGrowing` alert.

### Correctness (revert rate)

**Objective:** fewer than 5% of on-chain transactions revert, over 30 days.

```promql
sum(rate(transactions_reverted_total[30d]))
/
(sum(rate(transactions_confirmed_total[30d])) + sum(rate(transactions_reverted_total[30d])))
```

Recording rule (15m window): `job:transactions_reverted:ratio15m`

This isn't really a *worker performance* SLO — a revert usually means an
upstream problem (insufficient allowance, a paused contract, bad gas
estimation), not a confirmation-worker bug. It's tracked here because a
spike is one of the fastest signals that something is wrong with the
transactions being submitted, not with how they're being confirmed.

---

## Blockchain RPC

Not user-facing on its own, but almost every other SLO in this document is
downstream of RPC health, so it's worth its own objective as a
troubleshooting anchor: "is this an RPC problem?" should be answerable in
one query, not an investigation.

**Objective:** RPC error rate under 5%, over 30 days.

```promql
sum(rate(blockchain_rpc_requests_total{status="error"}[30d]))
/
sum(rate(blockchain_rpc_requests_total[30d]))
```

Recording rule (5m window): `job:blockchain_rpc_requests:error_ratio5m`

---

## Event listener

**Objective:** fewer than 5% of event-listener cycles fail, over 30 days.

```promql
sum(rate(event_listener_failures_total[30d]))
/
sum(rate(event_listener_cycles_total[30d]))
```

Recording rule (5m window): `job:event_listener_failures:ratio5m`

A failing event listener means incoming on-chain events (e.g. inbound
transfers) may not be picked up — this affects data completeness, not
transaction processing directly, which is why its objective is looser than
the confirmation worker's.

---

## What's deliberately not an SLO here

- **Worker readiness (`worker_ready`)** is alerted on directly
  (`WorkerNotReady`) rather than expressed as an SLO — it's binary and
  actionable on its own, an SLO/error-budget framing wouldn't add anything.
- **Multi-tenant fairness** (one noisy tenant degrading others) isn't
  measured at all yet. `transactions_created_total` and friends are
  labeled by `tenantId`, so the data exists to build this, but there's no
  rule or alert for it today — worth a follow-up if multi-tenant load
  testing surfaces a real need for it.