# Capacity Planning

## Status

Initial baseline established via `load-test/transfer-flow.js` against the
local `docker-compose.yml` stack (single-instance API + worker, Anvil,
Postgres, Redis, all on one machine). Numbers below are from real runs, not
estimates — see raw output in the corresponding incident docs and PR
history. Re-run and update this doc whenever a capacity-relevant change
lands (worker concurrency, backoff tuning, connection pool sizing, etc.).

## Measured runs

| Run | Submission p95 | Confirmation p95 | Confirmed rate | Notes |
|---|---|---|---|---|
| 1 VU / 20s | 8ms | ~1s | 100% | Baseline — no contention |
| 10 VU / 15s (cold) | 120.89ms | timed out (30s poll ceiling) | 67.82% | Short burst against a freshly-restarted stack |
| 30 VU / 60s (sustained) | 70ms | 6.02s | 100% | Steady-state, not a cold-start artifact |

## What's actually the bottleneck

**Not** the RPC layer, the database, or the API itself — `http_req_failed`
was 0% and submission p95 stayed under 500ms even at 30 concurrent VUs. The
system correctly accepts and submits transactions well beyond current test
concurrency.

**Is** the confirmation queue's retry backoff. `transactionConfirmationQueue`
used a fixed 5-second initial exponential backoff
(`CONFIRMATION_BACKOFF_DELAY_MS`, see `src/config/env.ts`), calibrated for a
real chain's block time (~12s on mainnet — a 5s first retry is reasonable
there). Against local Anvil, which auto-mines near-instantly, any
confirmation job whose first receipt check narrowly loses the race against
block production pays a needless ~5s penalty before its next attempt. At 30
VUs, confirmation p95 (6.02s) tracks almost exactly with this delay — strong
evidence this is the actual mechanism, not RPC contention or worker
starvation.

This has been made configurable (`CONFIRMATION_BACKOFF_DELAY_MS`) and set to
`500ms` in `docker-compose.yml` for local dev. **Re-run the 30-VU test after
this change lands and update the table above** — this doc should reflect
measured post-fix numbers, not just the diagnosis.

## Why the 10 VU / 15s run looked worse than the 30 VU / 60s run

Counterintuitive at first glance, but not a contradiction: the 10-VU run was
a 15-second burst immediately after a stack restart, while the 30-VU run was
a full minute of sustained load. A short burst against a cold stack (first
JIT warmup, first real connections opened, first Anvil blocks past genesis)
is a worse test of steady-state capacity than a longer sustained run — the
30-VU number is the more trustworthy one. This is itself a capacity-planning
lesson: **short bursts are not a substitute for sustained-load testing**,
and a capacity claim should specify which kind of run it's based on.

## Multi-tenant scaling axis (not yet measured)

All runs above hit a single tenant/user. This tests **transactions-per-tenant**
scaling, not **tenant-count** scaling — they stress different parts of the
system (queue/worker throughput vs. connection/row-count growth across many
tenants) and shouldn't be conflated. A follow-up run seeding N distinct
tenants and spreading load across them is needed before making any claim
about multi-tenant capacity.

## Open questions for the next pass

- What's the actual ceiling on worker concurrency (`concurrency: 5` in
  `confirmation.queue.worker.ts`)? Untested — current load never saturated
  it, since the bottleneck was backoff delay, not worker slot availability.
- What's the Postgres connection pool ceiling? `DATABASE_URL` has no
  `connection_limit` set anywhere (defaults to Prisma's
  `num_cpus * 2 + 1`) — untested at higher concurrency than 30 VUs.
- At what submission rate does Anvil itself become the bottleneck? Not
  reached in any run so far.
