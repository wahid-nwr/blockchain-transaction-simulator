# ADR-004: PostgreSQL-backed Scheduler Lease

## Status

Accepted

## Context

The confirmation worker runs periodic transaction maintenance tasks for:

- submission recovery
- transaction expiration

The original schedulers used process-local timers. When multiple worker instances were deployed, every instance executed the same database scan independently.

The platform should remain infrastructure-agnostic where practical. In particular, scheduler coordination should not depend on Redis, BullMQ, or a particular cache provider.

## Decision

Introduce a `SchedulerLease` abstraction with a PostgreSQL implementation.

The scheduler uses a short-lived lease before executing a maintenance cycle. Only the worker instance that successfully acquires the lease executes that cycle. The lease is renewed while a cycle is running and released when processing completes.

The application depends on the `SchedulerLease` interface rather than PostgreSQL directly. `PostgresSchedulerLease` is the current infrastructure implementation.

## Rationale

PostgreSQL is already a mandatory system-of-record dependency, so using it for scheduler coordination avoids introducing a new infrastructure coupling.

A lease table provides explicit ownership and expiry semantics, unlike a transaction-state flag. Atomic PostgreSQL `INSERT ... ON CONFLICT ... WHERE` acquisition prevents multiple workers from acquiring the same active lease.

The abstraction also permits a future implementation backed by another coordination mechanism without changing scheduler or processor code.

## Consequences

### Positive

- Multiple worker instances can safely run the same scheduler code.
- Only one worker performs each scheduler cycle.
- Scheduler coordination does not depend on Redis or BullMQ.
- Lease ownership expires automatically if a worker disappears.
- Existing processors remain unchanged.
- The coordination mechanism is replaceable through the `SchedulerLease` interface.

### Trade-offs

- PostgreSQL receives additional lightweight coordination queries.
- A lease can only provide best-effort exclusivity if a worker loses database connectivity while processing.
- Scheduler execution remains timer-driven; BullMQ is still used for asynchronous job execution.

## Lease lifecycle

```text
worker instance
      |
      | acquire
      v
 PostgreSQL
      |
   success
      |
      v
 run processor
      |
      +---- renew periodically ----+
      |                             |
      v                             |
 release <--------------------------+
```

A second worker attempting to acquire the same scheduler lease while it is active receives `false` and skips that cycle.
