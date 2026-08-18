# Load Testing

## Prerequisites

- Stack running locally: `docker compose up`
- [k6](https://k6.io/) installed
- A seeded tenant, user, token, and two wallets (see `docs/development.md`
  for seeding). Do **not** point this at a shared/staging environment
  without confirming with whoever owns it — this test creates real
  transactions.

## Running

```bash
export LOAD_TEST_EMAIL=load-test@example.com
export LOAD_TEST_PASSWORD=...
export LOAD_TEST_TOKEN_ID=...
export LOAD_TEST_FROM_WALLET_ID=...
export LOAD_TEST_TO_WALLET_ID=...

k6 run load-test/transfer-flow.js
k6 run --vus 50 --duration 2m load-test/transfer-flow.js
```

## What to do with the results

This script is instrumentation, not a benchmark result. Running it once and
eyeballing the output is not the deliverable — the deliverable is
`docs/capacity-planning.md` (roadmap Phase 3), which should record:

1. Baseline: throughput and p95/p99 latency at low concurrency (confirms
   the harness itself isn't the bottleneck).
2. Where it breaks first as VUs increase — API CPU, Postgres connection
   pool exhaustion, BullMQ/Redis queue depth, or RPC provider rate limiting.
   Watch `docs/observability.md`'s Prometheus dashboards while the test
   runs; the bottleneck should be visible there, not just inferred from k6
   output.
3. The specific, named change that raises each ceiling (e.g. "Postgres pool
   size is the limit at ~40 concurrent transfers; raising `connection_limit`
   in `DATABASE_URL` moves the ceiling to Redis/BullMQ throughput next").

A load-test script without a written-down bottleneck analysis is a much
weaker signal than one with three sentences saying exactly where the system
breaks and why.
