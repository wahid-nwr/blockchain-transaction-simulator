# Threat Model

## Status

Living document. Last reviewed against the codebase on this pass; update
whenever a trust boundary changes (new auth method, new custody path, new
external integration).

## Scope

This system custodies private keys (via envelope encryption / AWS KMS),
authenticates tenants and users, and executes real balance-affecting
operations against an Ethereum-compatible chain. The assets at risk are:

- **Wallet private keys** (custodial wallets)
- **Ledger integrity** (transaction/balance records must match on-chain
  reality)
- **Tenant isolation** (tenant A must never read or act on tenant B's data)
- **Availability** of the confirmation/event-listener pipeline

This document does not attempt to cover generic web-app hygiene (SQLi, XSS)
already handled by Prisma parameterization and Zod validation — it focuses
on threats specific to this system's trust boundaries.

---

## Trust boundaries

```text
[External client] --HTTPS--> [Fastify API] --SQL--> [PostgreSQL]
                                   |
                                   |--> [KMS / local envelope key] (wallet custody)
                                   |
                                   +--> [BullMQ / Redis] --> [Workers] --RPC--> [Chain]
```

Boundary 1: client -> API (authn/authz)
Boundary 2: API -> KMS (key custody)
Boundary 3: API/worker -> database (tenant isolation)
Boundary 4: worker -> RPC provider (chain trust)
Boundary 5: Redis (job queue integrity)

---

## STRIDE pass

### Spoofing

| Threat | Mitigation | Residual risk |
|---|---|---|
| Forged JWT | HMAC-signed via `@fastify/jwt`, short access-token TTL (`JWT_ACCESS_EXPIRES`), refresh rotation | `JWT_SECRET` defaults to a placeholder in dev config — **must** be enforced non-default in prod startup checks (currently relies on operator discipline, not a hard fail) |
| Forged/leaked API key | `ApiKey` model exists (`keyHash`, `keyPrefix`, `scopes`, `expiresAt`, `revokedAt`) | `src/auth/api-key.service.ts` is an empty file (0 lines) — the schema and table are in place but there's no hashing/lookup/rotation implementation, and `auth.routes.ts` currently resolves API keys through `tenantService.findByApiKey`, not through the dedicated `ApiKey` model at all. This is a second instance of the same pattern as the audit log: schema designed, wiring not finished. |

### Tampering

| Threat | Mitigation | Residual risk |
|---|---|---|
| Ciphertext tampering on custody key blob | AES-256-GCM auth tag (local path) / KMS-native integrity (prod path) | None material — GCM auth tag covers this |
| Direct DB write bypassing ledger invariants | Ledger service is the only writer of transaction lifecycle state (ADR-002) | Enforced by convention, not by DB-level constraints (e.g. no trigger preventing a raw `UPDATE` from setting an invalid state transition). A determined insider or a bug in a future service could bypass this. |

### Repudiation

| Threat | Mitigation | Residual risk |
|---|---|---|
| "We didn't authorize that transfer" | Structured logs with correlation IDs (`observability/context.ts`), transaction records include actor/tenant | **`AuditLog` is already modeled in `prisma/schema.prisma` (tenant/user/action/resource/metadata) but nothing in `src/` currently writes to it.** This is the single highest-value, lowest-effort item in this document — the schema design work is done, only the write path is missing. Even once wired up, rows remain mutable Postgres rows, not a write-once/hash-chained log; that's a further hardening step beyond just using the table. |

### Information disclosure

| Threat | Mitigation | Residual risk |
|---|---|---|
| Cross-tenant data leak | Repository methods are tenant-scoped (e.g. `findByIdForTenantWithCustody(walletId, tenantId)`) | This is enforced per-call-site by convention. There is no single choke point (e.g. Postgres Row-Level Security) that fails closed if a developer forgets to pass `tenantId` in a new query. This is the single highest-value hardening item in this category. |
| Private key exposure via logs | Signer service returns a wallet client, not the raw key, to callers | Should explicitly verify no code path ever logs `privateKey`/`decryptWalletKey` output — worth a lint rule or log-scrubbing test, not just a code-review habit |
| Local KMS master key exposure | `.env` files are gitignored; `LOCAL_KMS_MASTER_KEY` is dev/test only | This is explicitly a dev/test-only path (`isLocalProvider()`), which is the correct design — flagging so it stays that way in prod configs |

### Denial of service

| Threat | Mitigation | Residual risk |
|---|---|---|
| RPC provider outage stalls confirmation pipeline | Scheduler lease + BullMQ retry (ADR-004) | No documented circuit breaker / backoff ceiling for a sustained RPC outage — worker could retry-storm the provider. Worth a capacity-planning note (see `docs/capacity-planning.md`, Phase 3 of the roadmap). |
| Redis unavailability | Scheduler coordination deliberately does not depend on Redis (ADR-004) | Job *execution* (BullMQ) still does depend on Redis — a Redis outage stops new job execution even though scheduling coordination survives. This asymmetry should be called out in an incident runbook. |

### Elevation of privilege

| Threat | Mitigation | Residual risk |
|---|---|---|
| Tenant escalating to another tenant's wallet | JWT claims scope requests to a tenant; wallet repository queries are tenant-scoped | Same root cause as the information-disclosure item above — a missing `tenantId` filter in a future query is a privilege escalation, not just a leak. This is worth treating as one root-cause item, not two. |
| Role escalation (user -> admin) | `add_user_role` migration exists | Role-check enforcement should be verified at the middleware layer for every mutating route, not assumed from schema presence |

---

## Top 3 items if this were going to production tomorrow

1. **Row-Level Security (or an equivalent single choke point) for tenant
   isolation.** Convention-based scoping is the most common source of real
   multi-tenant breaches; it should not be the only line of defense here.
2. **Fail-closed startup validation** for `JWT_SECRET` and
   `LOCAL_KMS_MASTER_KEY` — refuse to boot in a `production`-flagged
   environment with a default/placeholder secret, rather than trusting env
   hygiene.
3. **Immutable audit trail** for custody-affecting operations (key
   decryption events, transaction signing), separate from application logs.

## Explicitly out of scope / accepted risk for this project

This is a portfolio/simulation project, not a production custody product.
The following are known and *intentionally* not hardened further here,
called out so it reads as a decision rather than an oversight:

- No HSM-backed key custody beyond AWS KMS envelope encryption
- No multi-party computation / threshold signing for custodial wallets
- No formal SOC 2 / compliance control mapping
- API-key auth path is a stub (`api-key.service.ts`) pending Phase 1/2 work
