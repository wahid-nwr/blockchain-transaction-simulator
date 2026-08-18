# Incident: production worker entrypoint pointed at a non-functional stub

## Status

Resolved.

## Summary

`docker-compose.yml`'s `worker` service ran `scripts/start-worker.prod.sh`,
which executed `dist/workers/confirmation.runner.js`. That file only started
the metrics/health HTTP server and flipped a readiness flag — it never
imported the BullMQ `confirmationQueueWorker`, never started the expiration
or submission-recovery schedulers, and never called `waitUntilReady()`.
The container reported healthy and logged `worker.ready`-style messages
from its own limited scope, but was structurally incapable of processing a
confirmation job.

The functionally complete implementation — BullMQ worker, both schedulers,
correct readiness wiring — lived in a separate, correctly named file,
`confirmation.queue.runner.ts`, which the *non-prod* `start-worker.sh`
correctly pointed to. The two files diverged at some point (likely a
refactor that split one runner into two and updated only one of the two
start scripts), and nothing caught the drift because:

- No integration/smoke test asserted that a submitted transaction actually
  reaches `CONFIRMED` end-to-end through the containerized stack.
- The Docker healthcheck only asserts the HTTP `/health` endpoint returns
  200 — which the broken stub could still legitimately do, since it started
  a real (if functionally empty) metrics server.

This is a good example of why "the container is healthy" and "the
container is doing its job" are different claims, and why only the second
one should be trusted without a mechanism that actually proves it.

## How it surfaced

Load-testing (`load-test/`) uncovered it — transactions submitted
successfully (201, on-chain write succeeded) but never transitioned past
`SUBMITTED`. Diagnosis path:

1. Checked Redis queue depth and DB transaction status distribution.
2. Found transactions failing before ever reaching the queue, due to an
   unrelated bug (`docs/decisions/005`-adjacent: KMS provider misconfigured
   in `docker-compose.yml`, fixed separately).
3. After fixing that, re-ran the worker and noticed the `docker compose ps`
   status was `unhealthy` despite log lines suggesting the worker was
   running fine — a signal worth trusting over the logs.
4. Traced `/health`'s readiness flag (`worker-metrics.server.ts`) and found
   it was set by a *different* symbol than the Prometheus `workerReady`
   gauge the runner touched — itself a real (separately fixed) bug.
5. That trace led to comparing `start-worker.prod.sh` against
   `start-worker.sh` and finding they pointed at two different files with
   very different implementations.

## Fix

- `scripts/start-worker.prod.sh` now points to `confirmation.queue.runner.js`
  (matching `start-worker.sh`).
- The stub `src/workers/confirmation.runner.ts` was deleted rather than
  fixed — nothing else referenced it, and keeping a second, incomplete
  "worker entrypoint"-shaped file around is itself the hazard.
- `confirmation.queue.runner.ts`'s readiness handling was corrected to call
  both the Prometheus gauge (`workerReady`, for scraping) and the HTTP
  health-endpoint flag (`setWorkerReady`, for Docker/orchestrator
  healthchecks) — they are different consumers and both need to reflect
  real state.

## Follow-up (tracked in roadmap)

- No test currently exercises the actual `docker-compose.yml` topology
  end-to-end (submit via HTTP -> confirm via worker container -> assert
  `CONFIRMED`). A smoke test that does this would have caught this
  immediately and should be added — see `docs/ROADMAP.md`, Phase 1.
- `docker compose ps` health status should be treated as a first-class
  signal in local dev workflow, not just CI — it was the thread that
  actually unraveled this.