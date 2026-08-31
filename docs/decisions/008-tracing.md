# ADR 008: Distributed Tracing with OpenTelemetry

## Status

Accepted

## Date

2026-08-30

---

# Context

ADR-003 established logging and metrics as two of the three observability
pillars, and named tracing as a "future improvement" — `tracing.ts` existed
only as a no-op `Span` interface with no real backend.

That gap matters specifically for this system's core diagnostic question,
the one ADR-003 opens with:

```text
Transaction Failed

        ?

API problem?

RPC problem?

Worker problem?

Blockchain problem?
```

Logs and metrics each answer part of this. Metrics say *whether* something
is slow or failing. Logs say *what happened* at a point in time, correlated
by a request/transaction id if you know which one to grep for. Neither
shows you the actual **path** a single transaction took across process
boundaries — API request thread, BullMQ job, RPC call — with per-segment
timing, in one place. That's specifically what tracing is for, and it's the
one pillar that was still a stub.

---

# Decision

Replace the no-op `Span` implementation with real OpenTelemetry spans,
exported over OTLP, while keeping the existing `Span` interface unchanged
so every call site written against it (`rpc.instrumentation.ts`, and any
future instrumentation) didn't need to change.

## SDK, not a vendor client

Used `@opentelemetry/sdk-node` with the standard OTLP HTTP exporter, not a
vendor-specific SDK (e.g. a Datadog or Honeycomb client library). The
exporter endpoint is just a URL
(`OTEL_EXPORTER_OTLP_ENDPOINT`); any OTLP-compatible backend works —
Jaeger, Grafana Tempo, or a commercial APM vendor — without touching
application code. This mirrors the same reasoning ADR-003 already applied
to metrics (Prometheus format, not a vendor push API).

## Auto-instrumentation, not manual spans everywhere

Rather than hand-instrumenting every HTTP handler and outbound call,
auto-instrumentation is enabled for the libraries actually in this stack's
critical path: HTTP, undici (viem's RPC transport goes through undici's
`fetch`, not Node's legacy `http` client), Fastify, and ioredis (BullMQ's
transport). This gets socket-level RPC timing, HTTP route spans, and queue
enqueue/dequeue spans without writing or maintaining that instrumentation
by hand.

Manual spans are added only at the boundaries that matter for *this*
system's diagnostic question specifically:

* `blockchain.rpc` (in `rpc.instrumentation.ts`) — every call to the chain.
* `transaction.confirm` (in `confirmation.processor.ts`) — the
  confirmation-worker unit of work, wrapping the RPC call so a trace shows
  "confirmation took 4s, 3.8s of which was one RPC call" instead of two
  disconnected numbers.

## Fail-open, always

Every layer of the tracing implementation is wrapped so a tracing failure
degrades to "no trace for this operation," never to a crashed request or
failed transaction:

* SDK initialization failure (bad endpoint config, missing dependency) is
  caught in `otel-preload.ts` — the process still starts.
* An unreachable OTLP collector logs an export failure asynchronously; it
  does not block or fail the request that generated the span.
* Every `Span` method (`setAttribute`, `recordException`, etc.) is
  individually try/caught in `tracing.ts` — the same defensive pattern
  `incrementMetric`/`observeMetric` already use in `metrics.ts`.

This is the same "Failure Isolation" principle ADR-003 states for metrics,
applied to tracing: *monitoring failures must never stop transaction
processing.*

## Preload pattern, not a decorator/middleware

OpenTelemetry's Node auto-instrumentation works by monkey-patching modules
(`http`, `undici`, etc.) the first time they're imported. That patching has
to happen before those modules are used anywhere else in the process. The
SDK bootstrap (`src/observability/otel-preload.ts`) is therefore imported
as the literal first line of every entrypoint
(`src/api/server.ts`, `src/workers/confirmation.queue.runner.ts`,
`src/workers/event-listener.runner.ts`) rather than initialized inside
`observability/bootstrap.ts` alongside the logger and metrics registry,
which run too late in the import graph for auto-instrumentation to catch
anything.

## Local dev: bundled Jaeger; prod: bring your own collector

`docker-compose.yml` bundles a Jaeger all-in-one container (OTLP receiver +
UI) so tracing is visible locally without any external account or setup.
`docker-compose.prod.yml` does not bundle a tracing backend — it exposes
`OTEL_EXPORTER_OTLP_ENDPOINT` as a pass-through environment variable, on the
same reasoning as `docs/ROADMAP.md`'s stated distinction between
`docker-compose.prod.yml` (local prod-parity) and real infrastructure-as-code:
a demo container is a convenience for local trace viewing, not a production
observability backend.

---

# Consequences

## Positive

### Answers ADR-003's original question directly

"API problem? RPC problem? Worker problem?" is now answerable by opening
one trace, not cross-referencing three dashboards.

### No instrumentation library lock-in

Swapping the tracing backend (Jaeger → Tempo → a commercial vendor) is an
environment variable change, not a code change.

### Consistent with the existing metrics safety model

Reused the same fail-open, try/catch-per-operation pattern already
established for metrics rather than inventing a new one.

## Negative

### A second process-startup-order constraint

The "must be the first import" requirement is easy to get wrong when adding
a new entrypoint in the future — nothing enforces it automatically, and the
failure mode (auto-instrumentation silently not patching) is quiet, not a
crash. This is a known sharp edge; if entrypoints multiply significantly it
may be worth a lint rule or a startup assertion instead of relying on code
review to catch it.

### Prisma is not yet traced

Auto-instrumentation was scoped to HTTP/undici/Fastify/ioredis — the
libraries directly in this system's RPC-and-queue critical path. Prisma
query spans (`@prisma/instrumentation`) were deliberately left out of this
pass: enabling it requires opting into Prisma's `tracing` preview feature
in `prisma/schema.prisma`, which is a schema change with broader
implications worth its own review, not a drive-by addition here. Traces
currently show "confirmation took 4s" without a breakdown of how much of
that was the database vs. the RPC call — DB latency has to be cross-referenced
against `pg` logs or Postgres's own tooling for now.

### One more moving part in local dev

`docker-compose.yml` now starts a ninth container. Tracing already fails
open if Jaeger isn't running, so this doesn't block anyone who doesn't care
about traces locally, but it is one more thing in `docker compose ps`.

---

# Alternatives Considered

## Leave tracing as a no-op stub indefinitely

Rejected because the RPC-vs-worker-vs-API triage question ADR-003 opens
with was still genuinely unanswered without it — logs and metrics don't
show a single transaction's cross-process path, and diagnosing exactly that
is the system's own stated hardest problem.

## A vendor-specific tracing SDK (e.g. Datadog's dd-trace)

Rejected for the same reason Prometheus was chosen over a vendor metrics
API in ADR-003: this is a demonstration system, not a system with an actual
production vendor contract, and OTLP keeps the backend swappable.

## Full `@opentelemetry/auto-instrumentations-node` (everything, not a hand-picked list)

Rejected as unnecessarily broad — it instruments filesystem access, DNS,
and other libraries not in this system's actual diagnostic critical path,
adding overhead and trace noise without adding signal for the "API/RPC/worker"
triage question this is actually solving.

---

# Future Improvements

* Prisma query spans, once the `tracing` preview feature question above is
  resolved on its own.
* A `SubmissionRecoveryScheduler`-equivalent for orphaned `PENDING`
  transactions surfaced tracing/metrics work — see
  `docs/runbooks/confirmation-worker-lag.md` — is a data-correctness gap
  tracing alone doesn't fix; noted here because it was found while wiring
  this ADR's metrics.
* Trace-to-log correlation via `getActiveTraceContext()` exists in
  `tracing.ts` but isn't yet wired into the Pino log format — logs and
  traces are currently correlated manually via `transactionId`/`requestId`,
  not automatically via `trace_id`.