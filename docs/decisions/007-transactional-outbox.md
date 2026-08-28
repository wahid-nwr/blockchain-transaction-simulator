# ADR-007: Transactional Outbox for Domain Event Publication

## Status

Accepted

## Context

Downstream systems (webhooks to tenants, analytics, future notification
services) need to react to transaction lifecycle events — most urgently,
`transaction.confirmed`. The obvious implementation is to publish an event
from `confirmation.processor.ts` right after the DB write that marks a
transaction `CONFIRMED`.

That obvious implementation has a dual-write problem: the DB commit and the
publish are two separate operations against two separate systems (Postgres
and BullMQ/Redis). If the process crashes between them, or the publish call
itself fails, the transaction is durably `CONFIRMED` in the ledger but no
event was ever emitted — a silent gap with no error, no retry, and no way
to detect it after the fact short of a reconciliation pass.

The `OutboxEvent` model already existed in `prisma/schema.prisma` (id,
aggregateId, type, payload, published) as a placeholder for exactly this,
but had no read or write call sites anywhere in `src/` — see ROADMAP Phase
0. This ADR is the decision record that Phase 0 item was missing.

## Decision

Write the event to an `OutboxEvent` row inside the same `prisma.$transaction`
as the state transition it describes, then relay it to BullMQ asynchronously
via a polling scheduler.

Concretely:

- `TransactionRepository.confirm()` and its underlying `transition()` helper
  accept an optional transaction client, so `confirmation.processor.ts` can
  wrap the state change and the outbox write in one `prisma.$transaction`.
- `OutboxRelayScheduler` — a `SchedulerLease`-coordinated poller with the
  same shape as `ExpirationScheduler` (see ADR-004) — claims unpublished
  rows (`published = false`, oldest first, indexed on
  `(published, createdAt)`) and enqueues them onto a new `outbox-relay`
  BullMQ queue.
- The relay uses the `OutboxEvent.id` as the BullMQ job ID. Enqueue happens
  before the row is marked published; if the process dies in between, the
  next tick re-claims the same row and re-enqueues with the same job ID,
  which BullMQ treats as a no-op rather than a duplicate job.

Only `transaction.confirmed` is produced today. `failed` / `expired` are not
wired — see Consequences.

## Rationale

This is the standard transactional-outbox pattern, chosen over the two
realistic alternatives:

- **Publish directly after the DB write (no outbox).** Simplest, and wrong
  for a ledger: it reintroduces exactly the dual-write gap this ADR exists
  to close. Rejected.
- **Postgres `LISTEN/NOTIFY` instead of a polling relay.** Lower latency,
  no polling overhead. Rejected for now because `NOTIFY` payloads are
  fire-and-forget — a relay that's down when the notification fires misses
  it permanently, with no row to recover from. The polling relay is slower
  but self-healing: a relay that was down simply catches up on unpublished
  rows next time it runs. Given confirmation events are not latency-critical
  (they follow on-chain confirmation, which is itself seconds-to-minutes),
  the durability trade-off favors polling. `LISTEN/NOTIFY` as a
  low-latency *supplement* to the poll (not a replacement for the durable
  row) is a reasonable future addition if event latency becomes a
  requirement.

BullMQ was chosen as the relay target over a dedicated event bus (Kafka,
NATS) because it's already a mandatory dependency for confirmation and
blockchain-event processing — the same reasoning ADR-004 applied to
choosing Postgres over Redis for scheduler coordination, applied in the
opposite direction here since BullMQ is the thing already paid for.

## Consequences

### Positive

- An event is either committed atomically with the state change it
  describes, or not committed at all. No dual-write gap.
- Relay crashes are self-healing — unpublished rows are just picked up on
  the next tick, by whichever instance holds the scheduler lease.
- Re-enqueue after a crash is a no-op, not a duplicate, via job-ID
  deduplication.
- The relay's DB load is bounded and predictable (indexed poll, same shape
  as `ExpirationScheduler`), not a new coordination primitive.

### Trade-offs

- At-least-once delivery, not exactly-once: a consumer of the
  `outbox-relay` queue can still see a job more than once if it fails after
  processing but before BullMQ marks it complete. Consumers must be
  idempotent on `(aggregateId, type)`. This is a property of the queue
  layer, not something the outbox write itself fixes.
- Latency is bounded by the poll interval (5s), not by event occurrence.
  Acceptable today per the rationale above; would need revisiting if a
  consumer needs sub-second delivery.
- **No downstream consumer exists yet.** The relay publishes to a queue
  nothing currently subscribes to — this ADR closes the write-side gap
  identified in ROADMAP Phase 0, not the "notify tenants" feature that
  would consume it. Building webhook delivery, retry/backoff-to-tenant-URL
  semantics, and delivery-status tracking without a concrete consumer
  requirement would be exactly the kind of scope padding the ROADMAP
  explicitly warns against. The stopping point here is deliberate.
- `failed` / `expired` transitions don't produce outbox events yet. Adding
  them is mechanical (same pattern as `confirmed`) once there's a consumer
  that needs them — deferred for the same reason as the point above.

## Event flow

```text
confirmation.processor.ts
        |
        | prisma.$transaction
        v
  +-----------------+
  | Transaction row |  status -> CONFIRMED
  | OutboxEvent row |  published = false
  +-----------------+
        |
        | (both committed together, or neither)
        v
  OutboxRelayScheduler (postgres lease, 5s tick)
        |
        | claim unpublished, oldest first
        v
  outboxRelayQueue.addBulk(jobId = OutboxEvent.id)
        |
        v
  mark OutboxEvent.published = true
```

A relay instance that crashes between enqueue and mark leaves the row
`published = false`; the next tick (by whichever instance holds the lease)
re-claims it and re-enqueues under the same job ID, which BullMQ treats as
already-present rather than a duplicate.