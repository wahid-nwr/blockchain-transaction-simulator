# Engineering Roadmap: From Senior to Staff/Architect Signal

## Purpose

This document is an honest, external assessment of the project against what a
staff/principal-level blockchain infrastructure hiring panel actually screens
for, plus a prioritized plan to close the gaps. It is written to be read on
its own — by a reviewer, or by future-me deciding what to work on next.

The project already demonstrates senior-level competence: layered
architecture, an event-driven indexer, a PostgreSQL-backed distributed
scheduler lease, KMS-backed key custody, structured observability, and
release/rollback CI pipelines with secret scanning. That is not the gap.

The gap is the set of things that specifically signal **staff/architect**,
as opposed to strong senior:

| Signal | Senior | Staff / Architect |
|---|---|---|
| Decisions | Makes good decisions | Documents *rejected* alternatives and *why*, including ones that were tempting |
| Correctness | Tests happy paths + edge cases | Proves invariants under failure (crash, partition, retry, replay) |
| Scale | Builds a working system | Has a documented story for 10x/100x load and knows where it breaks first |
| Security | Follows good practices | Has a threat model and can name what's *not* mitigated yet |
| Operations | Has metrics | Has SLOs, alert thresholds, and runbooks a stranger could follow at 3am |
| Communication | README describes the stack | README/case-study leads with the hardest problem and the trade-off made |

---

## Phase 0 — Finish what's already designed (do this first, it's cheap) — DONE

A schema/code audit turned up three Prisma models that were fully designed
but had **zero read/write call sites in `src/`**, plus one service file that
was a stub despite having a backing table. All four are now wired end to
end, with unit test coverage, and the full suite (unit, integration, e2e)
passes.

- [x] Implement `AuditLog` writes at the ledger/auth boundary. Wired into
  tenant creation, API key create/revoke, and login success/failure/register.
  Best-effort by design — a write failure is logged, never allowed to fail
  the operation it's describing. `GET /audit-logs` (admin, tenant-scoped)
  added for visibility. See `src/services/audit-log.service.ts`.
- [x] Implement `ApiKeyService` (hash on write, prefix-lookup + constant-time
  compare on read, honor `expiresAt`/`revokedAt`/`scopes`) and switch
  `auth.routes.ts` to use it. The old `TenantRepository.findByApiKey` /
  `TenantService.findByApiKey` path (unhashed-comparison lookup, no
  constant-time guarantee) was removed rather than left as a second,
  weaker verification path — see the note on incident 001 below for why
  that mattered. `POST/GET /tenants/me/api-keys` and
  `DELETE /tenants/me/api-keys/:id` added. See `src/auth/api-key.service.ts`.
- [x] Implement `IdempotencyKey` middleware for mutating API routes. Built as
  a reusable `withIdempotency()` guard (`src/api/middleware/idempotency.guard.ts`),
  wired into `POST /transactions` via an optional `Idempotency-Key` header.
  The guard's `find()` check is a fast path only, per ADR-005 — the actual
  correctness boundary is the DB unique constraint on `(tenantId, key)`; a
  losing concurrent `acquire()` surfaces as Prisma P2002 and the existing
  global error handler turns it into a clean 409. **Known scope limit:**
  retrying under the same key after a FAILED record isn't supported yet —
  the repository has no reset path, so a FAILED key currently requires a
  new key to retry. Worth revisiting if a real client needs same-key retry.
- [x] Implement `OutboxEvent` write-on-commit + a relay/publisher. The
  write happens inside the same `prisma.$transaction` as the transition to
  `CONFIRMED` (`confirmation.processor.ts` → `TransactionRepository.confirm`),
  so an event is either committed with the state change or not at all — the
  event can never be silently lost or leaked ahead of a rolled-back write.
  A `OutboxRelayScheduler` (same postgres-lease pattern as
  `ExpirationScheduler`, see ADR-004) polls unpublished rows and enqueues
  them to a new `outbox-relay` BullMQ queue, using the outbox event ID as
  the BullMQ job ID so a re-enqueue after a crash is a no-op rather than a
  duplicate. Only `transaction.confirmed` is wired as a producer today;
  `failed`/`expired` are natural next additions if a downstream consumer
  needs them. **No downstream consumer exists yet** — the relay publishes
  to a queue nothing currently subscribes to. That's an intentional,
  contained stopping point rather than building unrequested webhook
  delivery infrastructure (see "What NOT to do," below). No ADR was
  written for this yet — worth adding given every other Phase 0/1 decision
  has one; see the note in Phase 6.

## Phase 1 — Financial correctness & failure-mode proof (highest leverage)

This is a **ledger** system. For a blockchain-infra role, correctness under
failure is the single highest-signal thing to demonstrate — more than any
feature.

- [x] Real incident found and fixed via load-testing: production worker
  entrypoint pointed at a non-functional stub, so no confirmation job
  was ever actually processed despite the container reporting healthy.
  See `docs/incidents/001-worker-entrypoint-stub.md`.
- [ ] End-to-end smoke test against the actual `docker-compose.yml`
  topology (submit via HTTP -> confirm via the real worker container ->
  assert `CONFIRMED`). This is the single test that would have caught
  the above incident immediately, and its absence is the concrete gap
  the incident exposed.
- [x] ADR: idempotency and financial-correctness guarantees end-to-end
  (`docs/decisions/005-idempotency-and-financial-correctness.md`)
- [ ] Fault-injection test suite: kill the confirmation worker mid-cycle,
  mid-lease-renewal, and mid-DB-write; assert no double-credit, no lost
  transaction, no stuck PENDING state past expiration
- [ ] Reconciliation job + doc: periodic on-chain vs. ledger balance diffing,
  with alerting on drift

## Phase 2 — Threat model & security posture

- [ ] `docs/security/threat-model.md` — STRIDE-style pass over: JWT auth,
  API-key auth, wallet custody key handling (KMS), multi-tenant data
  isolation, RPC provider trust boundary
- [ ] Document what is explicitly **out of scope** / accepted risk — this is
  what separates a real threat model from a checklist

## Phase 3 — Capacity, load, and scale story

- [ ] k6 (or autocannon) load-test scripts against the transaction
  submission + confirmation flow, checked into `load-test/`
- [ ] `docs/capacity-planning.md`: current single-instance throughput
  ceiling, first bottleneck (RPC rate limits vs. DB connection pool vs.
  queue backpressure), and the specific change that raises each ceiling
- [ ] Document the multi-tenant scaling axis explicitly — what changes at
  10x tenants vs. 10x transactions-per-tenant (these are different
  scaling problems and conflating them is a common senior-level mistake)

## Phase 4 — Operational maturity

- [x] SLOs for the API (latency, availability) and workers (confirmation
  lag, event-processing lag) with the Prometheus queries that measure
  them — `docs/slo.md`, built on `monitoring/recording-rules.yml`
- [x] Alerting rules (as code, e.g. Prometheus alerting rules file) —
  `monitoring/alert-rules.yml`, wired into `docker/prometheus/prometheus.yml`
- [x] One real runbook: "confirmation worker is falling behind" — symptoms,
  diagnosis steps, mitigation, rollback — `docs/runbooks/confirmation-worker-lag.md`.
  Turned out to cover two genuinely different failure modes (worker actually
  slow vs. transactions orphaned in PENDING); see the runbook for why those
  aren't the same problem.
- [x] Real distributed tracing (OpenTelemetry, OTLP export) — was still a
  no-op stub; not originally scoped for this phase but came up while
  wiring the rest of Phase 4. See `docs/decisions/008-tracing.md`.

Follow-ups surfaced by this phase, not yet done:

- [ ] No automatic recovery for transactions orphaned in `PENDING` (process
  crash between transaction creation and chain submission) — currently a
  manual runbook step, not a scheduler. See
  `docs/runbooks/confirmation-worker-lag.md` "Prevent recurrence".
- [ ] Alertmanager routing — alert rules evaluate in Prometheus but nothing
  is wired to actually page anyone yet (no Alertmanager container, no
  PagerDuty/Slack integration).
- [ ] Prisma query spans — deliberately deferred, see `docs/decisions/008-tracing.md`.
- [ ] Trace-log correlation (`trace_id` in Pino output) — the hook exists
  (`getActiveTraceContext()` in `src/observability/tracing.ts`) but isn't
  wired into the logger yet.

## Phase 5 — Infrastructure as code

- [ ] Terraform (or Pulumi) module for the prod topology currently expressed
  only in `docker-compose.prod.yml` — even a minimal single-cloud module
  shows the muscle; doesn't need to be deployed anywhere real
- [ ] Explicit statement of what `docker-compose.prod.yml` is *for* (local
  prod-parity / small deployments) vs. what the IaC module is for
  (actual cloud deployment) — architects are expected to know which tool
  fits which job, not just have one of everything

## Phase 6 — Presentation

- [ ] Rewrite README opening to lead with the hardest problem solved, not
  the tech stack (stack becomes supporting detail, not the headline)
- [ ] Add real architecture/sequence diagrams (not ASCII) for: transaction
  lifecycle including worker-crash recovery, and the multi-tenant
  request path
- [ ] One public-style case-study write-up (suitable for a blog post or a
  "notable projects" portfolio page) on the postgres-scheduler-lease
  decision — it's the most interesting trade-off in the repo and is
  currently under-sold as ADR-004
- [ ] Write ADR-007 for the transactional outbox (Phase 0): why outbox over
  publishing directly from the confirmation processor, why BullMQ over a
  dedicated event bus at this scale, and the explicit call to stop at "no
  consumer yet" rather than build unrequested webhook delivery. Every
  other Phase 0/1 decision has an ADR; this one doesn't yet, and a
  reviewer who checked incident 001 by grepping the codebase (see below)
  would just as easily notice this gap.

---

## What NOT to do

- Don't add features (more chains, more token types) — that reads as scope
  padding, not depth, and dilutes the correctness/ops story.
- Don't rewrite working code for style reasons. Staff-level review rewards
  judgment about *what to leave alone*.
- Don't add Kubernetes manifests just to show Kubernetes — only add
  infrastructure that the capacity-planning doc actually justifies.

## Suggested order of execution

1. Phase 1 (financial correctness) — this is what a blockchain-infra
   interviewer will actually probe on
2. Phase 6 items for the ADR/README (cheap, high visibility)
3. Phase 2 (threat model)
4. Phase 3 (load test + capacity doc)
5. Phase 4 (SLOs/runbook)
6. Phase 5 (IaC) — lowest priority; least specific to *this* system's hard
   problems