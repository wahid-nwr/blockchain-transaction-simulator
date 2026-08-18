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

## Phase 0 — Finish what's already designed (do this first, it's cheap)

A schema/code audit turned up three Prisma models that are fully designed
but have **zero read/write call sites in `src/`**:

- `AuditLog` — tenant/user/action/resource/metadata audit trail
- `IdempotencyKey` — tenant-scoped request-hash + cached-response table for
  idempotent API mutations
- `OutboxEvent` — aggregate/type/payload table for reliable event
  publication

And one service file that is a stub despite having a backing table:

- `src/auth/api-key.service.ts` (0 lines) — `ApiKey` model exists with
  `keyHash`/`keyPrefix`/`scopes`/`expiresAt`/`revokedAt`, but
  `auth.routes.ts` currently resolves API keys through
  `tenantService.findByApiKey` instead of this model.

This is the single cheapest, highest-credibility fix available: it's not
new design work, it's finishing already-designed work. A reviewer who reads
the schema and then greps for usage (as was done here) will notice the gap
immediately — closing it before anything else is a strong signal of
attention to detail.

- [ ] Implement `AuditLog` writes at the ledger/auth boundary
- [ ] Implement `ApiKeyService` (hash on write, prefix-lookup + constant-time
  compare on read, honor `expiresAt`/`revokedAt`/`scopes`) and switch
  `auth.routes.ts` to use it
- [ ] Implement `IdempotencyKey` middleware for mutating API routes
- [ ] Implement `OutboxEvent` write-on-commit + a relay/publisher, or
  explicitly remove the table and note in an ADR why outbox wasn't
  needed after all — either outcome is fine, an unused table with no
  decision recorded is the only bad outcome

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

- [ ] SLOs for the API (latency, availability) and workers (confirmation
  lag, event-processing lag) with the Prometheus queries that measure
  them
- [ ] Alerting rules (as code, e.g. Prometheus alerting rules file)
- [ ] One real runbook: "confirmation worker is falling behind" — symptoms,
  diagnosis steps, mitigation, rollback

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