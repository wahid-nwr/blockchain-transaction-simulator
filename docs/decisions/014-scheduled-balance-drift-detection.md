# ADR 014: Scheduled Balance Drift Detection

## Status

Accepted

## Date

2026-09-29

# Context

ADR-013 made balance reconciliation chain-agnostic but left it on-demand, and
recorded a limit: `MISMATCH` against the chain head cannot tell indexer lag
from real drift. The roadmap asked for a scheduled job with alerting on drift.

Naively running the on-demand comparison on a timer and alerting on `MISMATCH`
would page constantly. A wallet with any activity is a few blocks behind head
by construction, so "snapshot != head" is the normal state, not a fault.

# Decision

## 1. A lease-guarded sweep, following the existing scheduler pattern

`BalanceDriftScheduler` + `BalanceDriftProcessor`, same shape as
`ExpirationScheduler` (ADR-004): `PostgresSchedulerLease`, lease renewal,
`worker_cycles_total` / `worker_failures_total` / `worker_duration_seconds`.
It is wired into the confirmation worker runner and has a
`BALANCE_DRIFT_ENABLED=false` kill switch. The processor takes the existing
`BalanceReconciliationService`; no comparison logic is duplicated.

## 2. Read at the indexer's frontier, not at head

Each token is read at `TokenEventCursor.lastProcessedBlock` (F). The listener
advances that cursor only after syncing balances for every log up to F, so a
snapshot that disagrees with the chain **at F** has no lag explanation: an
event at or before F was missed, mis-applied, or the row was altered. This is
what resolves ADR-013's open limitation, at the cost of one RPC read per
snapshot (the same as the head read it replaces).

## 3. Order of reads makes every race fail safe

Cursors are read before the snapshots they are compared with. If the indexer
moves during the check, the snapshot ends up at or ahead of F; the service
returns `STALE_OBSERVATION` (its existing `chain.blockNumber < persisted.blockNumber`
rule) and the snapshot is skipped until the next sweep. A race can therefore
hide drift for one sweep but cannot invent it.

## 4. Four outcomes, and "could not check" is not "fine"

`match`, `drift`, `stale_observation`, `unverified`. A read that throws
(RPC failure, pruned state, unsupported chain), a token with no cursor, or a
cursor at 0 is `unverified`: counted and logged, never `drift`, never silently
`match`. One bad read does not abort the sweep.

## 5. Metrics and alerts

- `balance_reconciliation_snapshots{blockchain,result}` — gauge, from the last
  **completed** sweep; every series is rewritten each sweep so a repaired drift
  returns to 0.
- `balance_reconciliation_last_sweep_timestamp_seconds` — set only when a sweep
  finishes, so a sweep that throws mid-way leaves it stale.
- Labels are `blockchain` only. Wallet/token IDs are unbounded cardinality and
  go in the `balance.drift.detected` log line.
- Alerts (`monitoring/alert-rules.yml`): `BalanceDriftDetected` (page),
  `BalanceReconciliationUnverifiable` (ticket), `BalanceReconciliationStale`
  (ticket). Runbook: `docs/runbooks/balance-drift.md`.

## 6. Alerts read only the latest sweep's gauges

The lease means the sweep runs on whichever replica holds it, and every replica
keeps exporting the values from the last sweep *it* ran. Alerting on the raw
gauge would keep reporting a stale `drift=1` from a replica that no longer
sweeps. A recording rule keeps only the series from the instance with the
newest sweep timestamp.

## 7. Detection only

The job never writes to the ledger. See Alternatives.

# Consequences

## Positive

- Drift alerts are meaningful: lag cannot trigger them.
- No new tables, no migration, no new dependency.
- Reuses the reconciliation service, lease, scheduler shape and metrics
  conventions already in the repo.

## Negative

- One RPC read per snapshot per sweep; cost grows linearly with snapshots.
  Bounded by `BALANCE_DRIFT_CONCURRENCY` and `BALANCE_DRIFT_INTERVAL_MS`, not
  sampled. Fine for this scale; revisit if the snapshot count reaches the
  point where a sweep no longer fits in its interval.
- Reading at F needs the RPC node to serve state at F. F is normally near
  head, but a lagging indexer or a pruning node produces `unverified`.
- Only wallets with a snapshot are checked; a wallet with an on-chain balance
  and no snapshot is invisible.
- Findings are not persisted: history lives in logs and Prometheus only.
- Alerts are not routed anywhere until Alertmanager is wired (roadmap).
- A fifth copy of the lease-scheduler boilerplate. Extracting a shared base
  class would be worthwhile but is a separate refactor across four existing,
  tested schedulers.

# Alternatives Considered

## Compare with head and tolerate N blocks of lag

Needs a per-chain tolerance (EVM blocks, Bitcoin heights and Solana slots have
wildly different durations), and a hot wallet can still exceed any fixed
tolerance. Reading at the indexer's own frontier removes the tolerance instead
of tuning it.

## Two reads per mismatch (head, then pinned at the snapshot's block)

Distinguishes "snapshot wrong at its own block" from "later update missed", but
cannot separate lag from a miss on its own, and would need a per-snapshot
persistence rule to avoid false alarms on busy wallets. The frontier read makes
the drift/lag distinction directly; the cause classification is left to the
runbook, using the existing `?blockNumber=` on the reconcile endpoint.

## Persist findings in a `BalanceDriftEvent` table

Would give history and an audit trail, and is a reasonable follow-up. Deferred:
it needs a migration and lifecycle rules (open/resolved, dedupe per snapshot)
for something the gauge and logs already cover for alerting.

## Auto-repair by re-syncing the snapshot

Rejected. `BalanceRepository.upsert` is deliberately monotonic, so it cannot
overwrite a wrong snapshot at the same block. Forcing it would let a detector
silently rewrite financial state, which is exactly when a human should look. The
runbook documents the two manual repairs.

## Alert on a counter of drift events

A counter only says drift was seen at some point; it cannot say whether it is
still there. The alert wants "how many are wrong now", which needs a gauge.

# Future Improvements

- Alertmanager routing, so `BalanceDriftDetected` actually pages someone.
- Persisted drift findings (see above).
- Check for wallets that have tokens on-chain but no snapshot.
- `getTokenBalance` for Bitcoin/Solana (ADR-013 future work); until then their
  snapshots are `unverified`.
- Extract a shared lease-scheduler base class.
