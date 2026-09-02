# ADR 005: Idempotency and Financial-Correctness Guarantees

## Status

Accepted

## Date

2026-08-17

---

## Context

This system is a ledger. Its core promise isn't "the API responds
correctly" — it's "the recorded balance always matches on-chain reality,
even when a worker crashes, a job is redelivered, or two processes race on
the same transaction." That promise has to survive every failure mode a
distributed worker fleet can produce:

- A confirmation worker crashes mid-write, after submitting to the chain
  but before persisting the transaction hash.
- BullMQ redelivers a job because a worker failed to `ack` in time, even
  though the first attempt actually completed.
- Two worker instances briefly both believe they hold the scheduler lease
  (ADR-004 treats this as best-effort, not impossible) and both attempt to
  process the same expiring transaction.
- The RPC provider returns a transient error *after* the transaction was
  already broadcast, so a naive retry double-submits.

None of these are exotic. In a queue-plus-worker architecture talking to an
external, non-transactional system (a blockchain), they are the normal
case, not the edge case. The question this ADR answers: **what specifically
guarantees a transaction is never double-processed and never silently
lost?**

---

## Decision

Correctness rests on three independent layers, deliberately overlapping so
that no single one is load-bearing alone:

### 1. A closed, explicit state machine (`TransactionStateMachine`)

Every transition is allow-listed (`PENDING -> SUBMITTED -> CONFIRMING ->
{CONFIRMED | FAILED | EXPIRED}`), and terminal states (`CONFIRMED`,
`FAILED`, `EXPIRED`) have **no outgoing transitions at all**. This means a
redelivered job that tries to re-confirm an already-`CONFIRMED` transaction
doesn't need bespoke duplicate-detection logic — the state machine itself
rejects the transition and the processor treats that as a no-op, not an
error.

This is the cheapest and most important layer: most "double processing"
bugs in queue systems are really "we didn't have a formal state machine, so
we couldn't tell an old event from a new one." Making terminal states
mechanically unreachable-from removes an entire bug class rather than
patching it case-by-case.

### 2. Natural idempotency keys at the persistence boundary

Transaction hash and log-index-based identifiers (see the transfer-event
identity migration) act as unique constraints at the database level, not
just application-level checks — `TokenTransfer` has `@@unique([transactionHash,
logIndex])`. A redelivered "record this confirmed transfer" job that races a
first attempt fails on the unique constraint rather than creating a
duplicate row. This is deliberate: **application-level idempotency checks
(check-then-write) are inherently racy under concurrent workers; a
DB-level uniqueness constraint is not.**

Note: the schema also already defines a general-purpose `IdempotencyKey`
table (tenant-scoped request hash + cached response + TTL) intended for
idempotent API mutations (e.g. "create transaction" retried by a client
after a timeout), and an `OutboxEvent` table for reliable event publication.
Neither is currently written to from `src/` — the natural-key uniqueness
described above is what actually protects the confirmation pipeline today.
The `IdempotencyKey`/`OutboxEvent` tables represent the *next* layer
(client-facing request idempotency and reliable cross-service event
delivery, respectively) and are correctly scoped out of this ADR's claims
until they're wired up — see roadmap Phase 1.

### 3. Coordinated scheduling, not coordinated execution (ADR-004)

The scheduler lease prevents *redundant scans* (multiple workers scanning
for expiring transactions simultaneously), which is a throughput and
lock-contention concern. It is explicitly **not** the mechanism relied on
for correctness — even if the lease briefly double-grants, layers 1 and 2
above are what prevent that from corrupting state. This separation of
concerns is intentional: lease semantics are best-effort by nature (network
partitions, clock skew), so nothing correctness-critical should depend on a
lease being perfectly exclusive.

---

## Alternatives considered

### Event sourcing / append-only transaction log as source of truth

Rejected for this system's scope. Event sourcing gives the strongest
replay/audit guarantees, but the operational cost (snapshotting, projection
rebuilds, a second query model) isn't justified by the current
requirements. Revisit if an immutable audit trail becomes a hard
requirement (see threat model, "Repudiation").

### Distributed lock (Redis/Redlock) around each transaction's processing

Rejected as the *primary* correctness mechanism, though BullMQ (Redis-backed)
is still used for job execution. A lock only prevents concurrent processing
while held — it does not, by itself, prevent duplicate processing from
message redelivery after a lock has already been released and reacquired.
Relying on a lock as the sole correctness boundary would mean correctness
depends on Redis availability and lock-timeout tuning, which is a weaker
guarantee than a DB unique constraint that's true forever regardless of
which process asks.

### Optimistic concurrency (version column, compare-and-swap on every write)

Considered as an addition, not a replacement. The closed state machine
already gives most of this benefit for transaction status specifically,
because an invalid transition is rejected outright rather than silently
overwritten. A version column would add value primarily for
multi-field concurrent updates outside the state machine's scope (e.g. two
processes updating different metadata fields on the same row) — flagged as
a future improvement, not implemented broadly today.

---

## Consequences

### Positive

- Duplicate job delivery is safe by construction at two independent layers
  (state machine + DB constraint), not by careful process discipline.
- The scheduler lease can degrade to "occasionally imperfect" under network
  partition without becoming a correctness incident — it only becomes a
  throughput/log-noise incident.
- New processors inherit these guarantees automatically as long as they
  route status changes through `TransactionStateMachine` and through
  repository methods with the relevant unique constraints — the correctness
  boundary is structural, not something each new processor has to
  re-implement.

### Negative / residual risk

- These guarantees protect **internal** state consistency. They do not by
  themselves prove the ledger matches on-chain reality — that requires the
  reconciliation job described in the roadmap (Phase 1), which this ADR
  does not yet cover.
- There is currently no fault-injection test that kills a worker
  mid-transition and asserts the invariant holds end-to-end (see roadmap,
  Phase 1) — the guarantee is architecturally sound but not yet
  mechanically proven by a test that actually induces the crash.

**Update (2026-08-30):** the specific crash window named above under
"Context" — a process crashing after `writeContract()` broadcasts but
before the transaction hash is persisted — is now handled for the
`PENDING → SUBMITTED` case by `PendingRecoveryScheduler`
(`src/workers/pending-recovery.processor.ts`, built alongside the Phase 4
observability work; see `docs/runbooks/confirmation-worker-lag.md`). It
doesn't replace the reconciliation job this ADR still calls out as missing
— it's narrower and reactive by construction: it cross-references the
event listener's independently-observed `TokenTransfer` records for
*specific transactions already known to be orphaned in PENDING*, using a
from/to/amount heuristic that can't distinguish two genuinely identical
concurrent transfers between the same two wallets (documented in the
processor itself). A real reconciliation job — comparing the full ledger
against full on-chain state on an ongoing basis, not just orphaned rows —
is still the stronger guarantee and is still open.

---

## Follow-ups tracked in the roadmap

- Chaos/fault-injection tests simulating crash-mid-write and job
  redelivery, asserting no double-credit
- Reconciliation job comparing ledger state to on-chain state on a
  schedule, with drift alerting