# Runbook: Confirmation Worker Is Falling Behind

## Who this is for

You've been paged (or you're investigating a `ConfirmationLatencyHigh`,
`WorkerFailureRateHigh`, `PendingTransactionsBacklogGrowing`, or
`WorkerNotReady` alert) and you don't have deep context on this system. This
walks you through figuring out which of two *different* problems you're
actually looking at, and what to do about each.

**Read this first:** "the confirmation worker is falling behind" and
"transactions are stuck in PENDING" are two unrelated failure modes that
sound similar. Confusing them wastes time. See "Which problem do I have?"
below before doing anything else.

---

## Which problem do I have?

Submission (creating a transaction and sending it to chain) happens
**synchronously inside the API request** — not in a background worker. The
confirmation worker only ever processes transactions that have *already*
been submitted (`SUBMITTED → CONFIRMED`). So:

| Symptom | Metric | Actual cause |
|---|---|---|
| Transactions stuck in `PENDING` | `confirmation_worker_pending_transactions` | An API request crashed/died between creating the transaction and submitting it to chain. `PendingRecoveryScheduler` should resolve this automatically within `PENDING_RECOVERY_FAIL_AFTER_MS` (default 15m) — see [Problem B](#problem-b-transactions-stuck-in-pending) for what to check if it isn't. |
| Transactions stuck in `SUBMITTED`/`CONFIRMING`, confirmation taking a long time | `job:transaction_confirmation_duration_seconds:p95_15m`, `worker_ready`, `worker_name:worker_failures:ratio5m` | The confirmation worker itself is slow, crashed, or its RPC calls are failing. See [Problem A](#problem-a-the-confirmation-worker-is-actually-falling-behind). |

Run this first to see which one you have:

```promql
# Is the pending backlog growing? (Problem B)
confirmation_worker_pending_transactions

# Is confirmation itself slow? (Problem A)
job:transaction_confirmation_duration_seconds:p95_15m

# Is the worker even up?
worker_ready{worker_name="confirmation-worker"}
```

---

## Problem A: the confirmation worker is actually falling behind

Symptoms: `job:transaction_confirmation_duration_seconds:p95_15m` is
elevated (SLO: p95 < 60s, see `docs/slo.md`), and/or
`ConfirmationLatencyHigh` / `WorkerFailureRateHigh` fired.

### 1. Check whether this is an RPC problem first

The confirmation worker's job is almost entirely RPC calls
(`getTransactionReceipt`). RPC degradation is the single most likely cause
of confirmation slowness, and it's easy to rule in or out:

```promql
job:blockchain_rpc_requests:error_ratio5m
method:blockchain_rpc_duration_seconds:p95_5m{method="getTransactionReceipt"}
```

If the RPC error ratio is elevated or `RPCProviderDown` fired: this is an
RPC provider problem, not a confirmation-worker bug. Check your RPC
provider's status page. There is nothing to fix in this codebase — the
worker will catch up once the provider recovers (confirmed transactions
aren't lost, they're just slow to confirm; `executeRpc()`'s built-in retry
with backoff already handles transient RPC blips on its own).

### 2. Check whether the worker process is actually running

```promql
worker_ready{worker_name="confirmation-worker"}
worker_cycles_total{worker_name=~"expiration-scheduler|submission-recovery-scheduler"}
```

- `worker_ready == 0` for more than ~2 minutes past startup: the worker
  failed a readiness dependency (DB, Redis, or RPC — see
  `src/api/health/readiness.service.ts` for what's checked) and never
  recovered. Check worker logs (`docker compose logs worker` or your
  platform's equivalent) for `readiness.rpc.failed` or similar — the log
  line names which dependency failed.
- If `worker_cycles_total` for the schedulers isn't advancing at all: the
  whole worker process is likely down or crash-looping. Check
  `docker compose ps worker` / your orchestrator's pod status.

### 3. Check for a stalled or crash-looping BullMQ worker

The confirmation queue worker (`src/workers/confirmation.queue.worker.ts`)
runs with `concurrency: 5` — five transactions confirming at once, max. If
individual confirmations are slow (step 1 ruled out RPC), a growing number
of transactions can back up behind that concurrency limit.

```promql
worker_name:worker_failures:ratio5m
```

If this is elevated for `confirmation-worker`: check worker logs for
`confirmation.job.failed` — this log line includes the transaction id and
error. A repeating error across many transactions (not isolated to one
transaction) points at something systemic — a bad DB connection, an RPC
client misconfiguration — not a data problem with any individual
transaction.

### 4. Mitigation

- **RPC provider degraded:** wait it out, or fail over to a backup RPC
  endpoint if your deployment has one configured (`RPC_URL` env var) — this
  requires a restart to pick up.
- **Worker crash-looping:** check the crash reason in logs, then restart:
  `docker compose restart worker` (dev/prod-parity) or your orchestrator's
  restart mechanism. `SubmissionRecoveryScheduler` and BullMQ's own job
  retry (`attempts: 5`, exponential backoff — see
  `transfer.service.ts`/`submission-recovery.processor.ts`) mean a restart
  does not lose transactions that were already submitted; anything
  in-flight gets picked back up.
- **Genuinely under-provisioned** (RPC and worker both healthy, just too
  much volume for `concurrency: 5`): this is a capacity problem, not an
  incident — see `docs/ROADMAP.md` Phase 5 for the horizontal-scaling
  story; there is currently no autoscaling to trigger.

### Rollback

If a recent deploy is the suspected cause (check `deployment_info` for the
currently running version against your deploy log), roll back:

```bash
./scripts/rollback.sh
```

This rolls the `worker` (and `api`) containers back to the previously
deployed image and re-runs `scripts/health-check.sh` automatically. It does
not touch data — `docker-compose.prod.yml`'s Postgres volume is untouched
by a rollback, and in-flight transactions resume processing under the
rolled-back version once it's healthy.

---

## Problem B: transactions stuck in PENDING

Symptoms: `confirmation_worker_pending_transactions` is elevated and/or
`PendingTransactionsBacklogGrowing` fired, but the confirmation worker
itself is healthy (Problem A's checks all come back clean).

**This should now self-heal within `PENDING_RECOVERY_FAIL_AFTER_MS`
(default 15 minutes)** — `PendingRecoveryScheduler` handles this
automatically (see step 3 below). If the alert has been firing for
noticeably longer than that, something's wrong with the scheduler itself,
not just an ordinary orphaned transaction — check step 3 first.

### 1. Confirm these are actually orphaned, not just new

A transaction sits in PENDING only for the duration of one API request —
milliseconds to a couple seconds. A transaction that's been in PENDING for
more than a minute or two did not complete its submission and nothing will
retry it automatically (there is no `SubmissionRecoveryScheduler`
equivalent for PENDING — that scheduler only recovers transactions that are
already `SUBMITTED`). Confirm with:

```sql
SELECT id, "tenantId", "createdAt", NOW() - "createdAt" AS age
FROM "Transaction"
WHERE status = 'PENDING'
ORDER BY "createdAt" ASC
LIMIT 50;
```

### 2. Find out why the request didn't finish

Search API logs around each transaction's `createdAt` for
`transaction.submission.started` without a matching
`transaction.submission.completed` or `transaction.submission.failed` for
that transaction id. A normal thrown error (RPC failure, insufficient
allowance, etc.) is already caught by `TransferService.transfer()` and
correctly marks the transaction `FAILED` — so if you're seeing orphaned
PENDING rows, the API process most likely **crashed or was killed**
mid-request (OOM, deploy/restart racing an in-flight request, uncaught
exception outside the try/catch). Check for API restarts around the
affected timestamps:

```bash
docker compose logs api --since <approximate time> | grep -i "SIGTERM\|exit\|restart"
```

### 3. Mitigation

`PendingRecoveryScheduler` handles this automatically — it runs as part of
the unified worker process (`confirmation.queue.runner.ts`) alongside
`ExpirationScheduler` and `SubmissionRecoveryScheduler`, on the same
lease-coordinated cycle. For each orphaned PENDING transaction (older than
`PENDING_RECOVERY_GRACE_MS`, default 2 minutes) it:

1. Looks for independent on-chain evidence — a `TokenTransfer` row written
   by the event listener (which observes the chain directly, unaffected by
   the crashed request) matching the transaction's `tokenId`/`from`/`to`/`amount`.
   If found, it **adopts** it: transitions the transaction to `SUBMITTED`
   with the discovered hash and enqueues the normal confirmation job — from
   there it's indistinguishable from any other submission.
2. If no match is found, it only marks the transaction `FAILED` after a
   second, longer threshold (`PENDING_RECOVERY_FAIL_AFTER_MS`, default 15
   minutes) — and only if the event listener itself is confirmed healthy
   (`TokenEventCursor.lastSuccessfulSync` within
   `PENDING_RECOVERY_LISTENER_STALENESS_MS`, default 60s). If the listener
   is stale, it defers rather than risk marking FAILED a transfer that
   actually succeeded on-chain but hasn't been indexed yet.

See `src/workers/pending-recovery.processor.ts` for the full reasoning,
including the known limitation of the matching heuristic (two genuinely
distinct transfers of the same amount between the same two wallets, both
broadcast in the same window, are indistinguishable by this query alone).

You generally shouldn't need to intervene manually — check
`worker_cycles_total{worker_name="pending-recovery-scheduler"}` and
`worker_failures_total{worker_name="pending-recovery-scheduler"}` to
confirm the scheduler itself is running and healthy. If it's been down long
enough that the backlog is paging you, the fix is the same as
[Problem A](#problem-a-the-confirmation-worker-is-actually-falling-behind)'s:
check `worker_ready`, check logs for `pending.recovery.scheduler.failed`,
restart the worker if it's crash-looping.

If you do need to intervene manually (e.g. the scheduler itself is down and
can't be brought back up quickly), the safe manual fallback is unchanged
from before this scheduler existed — go through the state machine, not a
raw `UPDATE`:

```sql
SELECT id, "tenantId", "createdAt", NOW() - "createdAt" AS age
FROM "Transaction"
WHERE status = 'PENDING'
ORDER BY "createdAt" ASC
LIMIT 50;
```

```ts
import { TransactionRepository } from '../src/repositories/transaction.repository.js';

const repo = new TransactionRepository();
await repo.markFailed(transactionId, 'Orphaned in PENDING — API process crashed mid-submission');
```

Do **not** hand-write `UPDATE "Transaction" SET status = 'FAILED' ...` — it
bypasses the state machine's transition guard, and it skips exactly the
on-chain evidence check that makes this safe in the first place.

### 4. This is now handled — no further action needed

Previously this section said "track this as a real backlog item" — it's
been built (`PendingRecoveryScheduler`). If you're seeing this problem
recur *despite* the scheduler running and healthy, that's a genuinely new
finding worth its own investigation, not something this runbook already
anticipates — the matching heuristic's limitation (identical-amount
transfers between the same two wallets) is the most likely edge case to
check first.

---

## After the incident

Whichever problem it was, update `monitoring/alert-rules.yml`'s thresholds
if they fired too late or too early for what actually happened, and add
anything you learned to this runbook — a runbook that doesn't get updated
after the incident it was used for is the first one to go stale.