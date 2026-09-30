# Runbook: Balance Drift

## Who this is for

You've been paged for `BalanceDriftDetected`, or ticketed for
`BalanceReconciliationUnverifiable` / `BalanceReconciliationStale`, and want to
know what the check actually proves and what to do next.

## What the check does

`BalanceDriftScheduler` (lease-guarded, default every 5 minutes) sweeps every
`BalanceSnapshot` (inactive tokens included — the indexer still updates them). For each token it reads
`TokenEventCursor.lastProcessedBlock` (call it **F**) — the position the event
indexer says it has fully processed — then asks the chain for the wallet's
balance **at F** and compares it with the snapshot.

Reading at F rather than "latest" is the point: a busy wallet is always a few
blocks behind head, so head-vs-snapshot would false-alarm constantly. At F,
indexer lag is not an explanation. See `docs/decisions/014-scheduled-balance-drift-detection.md`.

Each snapshot ends a sweep as one of: `match`, `drift`, `stale_observation`
(the snapshot moved past F mid-check — harmless), or `unverified` (couldn't be
checked).

The job is **detection only**. It never writes to the ledger.

---

## `BalanceDriftDetected` (page)

The snapshot for at least one wallet/token disagrees with the chain at a block
the indexer claims to have processed. The ledger is wrong for those wallets.

### 1. Find what drifted

Worker logs, message `balance.drift.detected`. Fields: `walletId`, `tokenId`,
`symbol`, `frontier` (F), `persisted.{balance,blockNumber}`, `chain.{balance,blockNumber}`.

### 2. Decide which kind of drift it is

Use the existing on-demand endpoint, pinned to the **snapshot's own block**
(`persisted.blockNumber` from the log line):

```text
GET /api/v1/tokens/:tokenId/balance/:walletId/reconcile?blockNumber=<persisted.blockNumber>
```

| Result at the snapshot's own block | Meaning |
|---|---|
| `MATCH` | The snapshot was right when written. A balance change **after** it was never applied — a **missed update**. |
| `MISMATCH` | The snapshot was **wrong when written** (e.g. the block was reorged after indexing, or the row was edited by hand). |

If the pinned read fails (RPC error), your node has probably pruned that
block's state — you need an archive-capable RPC to classify this.

### 3. Repair

**Missed update.** Rewind the token's cursor to just before the snapshot's block
so the listener replays from there:

```sql
UPDATE "TokenEventCursor"
SET "lastProcessedBlock" = <persisted.blockNumber - 1>
WHERE "tokenId" = '<tokenId>';
```

Rewind by as little as you can: the listener replays with a single `getLogs`
from the cursor to head (`src/workers/event.listener.ts`, no chunking), and many
RPC providers reject ranges beyond a few thousand blocks. If the replay fails,
the cursor stays put and `EventListenerFailureRateHigh` will tell you.

Replaying is safe: `TransferEventService` skips creating a transfer it already
has but still re-syncs both wallets' balances, and the snapshot upsert only ever
moves forward. Expect extra RPC load while it catches up, and note the alert can
briefly clear during the replay (F is lower, so snapshots ahead of it are
`stale_observation`). Confirm it stays clear after the cursor catches up.

**Snapshot wrong at its own block.** Replay will **not** fix this: the upsert
refuses to overwrite a snapshot with one at the same block. Find out why first
(RPC provider inconsistency? reorg deeper than the listener's one-block
overlap? manual edit — check `AuditLog`?), then correct the row from the chain
value in the log line.

### 4. Don't just silence it

A drifted snapshot means balance-dependent decisions may already have used a
wrong number. Check `Transaction` rows for the affected wallet since
`persisted.blockNumber`.

---

## `BalanceReconciliationUnverifiable` (ticket)

Over half of a chain's snapshots couldn't be checked. Look at the reason in the
worker logs:

| Log message | Cause | Action |
|---|---|---|
| `balance.drift.unverified.no_cursor` | Token has no cursor or it's at 0 — the indexer hasn't completed a sync | Is the event listener running? See `EventListenerFailureRateHigh` |
| `balance.drift.unverified.check_failed` | The read threw (`error` field) | RPC errors → `RPCHighErrorRate`; a "missing trie node"-style error → your node pruned state at F, use an archive-capable RPC |

No drift is being reported while this fires — which is not the same as none existing.

## `BalanceReconciliationStale` (ticket)

No sweep has completed for 20+ minutes, so `BalanceDriftDetected` cannot fire.

- Is a worker up? `worker_ready`, and `worker_failures_total{worker_name="balance-drift-scheduler"}`.
- Is another instance holding the lease?
  `SELECT * FROM "SchedulerLease" WHERE name = 'balance-drift-scheduler';`
  (an `expiresAt` in the past means it's free and the next tick takes it).
- Was it disabled? `BALANCE_DRIFT_ENABLED=false` is a kill switch and will trip
  this alert by design. Re-enable it, or accept the alert.
- Is a sweep just slow? Compare `worker_duration_seconds{worker_name="balance-drift-scheduler"}`
  with the interval; raise `BALANCE_DRIFT_CONCURRENCY` or `BALANCE_DRIFT_INTERVAL_MS`.

---

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `BALANCE_DRIFT_ENABLED` | `true` | Set `false` to not start the job |
| `BALANCE_DRIFT_INTERVAL_MS` | `300000` | Time between sweeps |
| `BALANCE_DRIFT_PAGE_SIZE` | `200` | Snapshots loaded per DB page |
| `BALANCE_DRIFT_CONCURRENCY` | `5` | Concurrent chain reads (one read per snapshot) |

If you change the interval, revisit the `for:` durations in
`monitoring/alert-rules.yml` — `BalanceDriftDetected` assumes two sweeps fit in
10 minutes, and `BalanceReconciliationStale` assumes a 20 minute silence is
abnormal.

## Known blind spots

- Only wallets that **have a snapshot** are checked. A wallet holding tokens
  on-chain but with no snapshot (first event missed, or funded before the wallet
  was registered) is invisible.
- Only chains whose adapter implements `getTokenBalance` — today EVM. Bitcoin
  and Solana snapshots would be `unverified`.
- Non-transfer balance changes (e.g. a rebasing token) look like drift.
- Alerts are evaluated by Prometheus (the prod compose mounts `./monitoring`
  as its rule directory) but **nothing routes them yet** (`docs/ROADMAP.md`,
  "Alertmanager routing"). Until that lands, drift is only visible on the
  Prometheus alerts page and in logs. In prod Prometheus listens on
  `127.0.0.1:9090` only, so use `ssh -L 9090:localhost:9090 <host>` and open
  `http://localhost:9090/alerts`.
