/**
 * OpenTelemetry SDK bootstrap.
 *
 * USAGE: this file must be the FIRST import in every process entrypoint
 * (src/api/server.ts, src/workers/confirmation.queue.runner.ts,
 * src/workers/event-listener.runner.ts) — before fastify, before viem,
 * before anything that touches http/undici/ioredis. OpenTelemetry's
 * auto-instrumentation works by monkey-patching those modules the first
 * time they're required/imported; if this file runs after them, the
 * patches miss and spans silently don't appear.
 *
 * In an ES module ("type": "module") this ordering is satisfied simply by
 * making `import './observability/otel-preload.js'` the first import
 * statement in the entrypoint file: sibling static imports in one module
 * are evaluated depth-first in the order they're written, and this file has
 * no dependency on any app code, so it finishes executing before the next
 * import in that file begins.
 *
 * Tracing is an enhancement, not a dependency — every failure mode here
 * (bad endpoint, collector down, missing env var) must degrade to "no
 * traces" rather than crash the process. See docs/decisions/008-tracing.md.
 */
import { NodeSDK } from '@opentelemetry/sdk-node';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { UndiciInstrumentation } from '@opentelemetry/instrumentation-undici';
import { FastifyOtelInstrumentation } from '@fastify/otel';
import { IORedisInstrumentation } from '@opentelemetry/instrumentation-ioredis';
import { diag, DiagConsoleLogger, DiagLogLevel } from '@opentelemetry/api';

// Tracing defaults ON, except in the test env where dozens of short-lived
// vitest processes hammering a collector that (usually) isn't running would
// just add noisy export-failure log lines to every test run for no benefit.
// Everywhere else — dev, CI e2e, prod — it's on by default so "we forgot to
// turn it on" isn't a way to lose trace coverage.
const enabled =
    (process.env.OTEL_TRACES_ENABLED ?? (process.env.NODE_ENV === 'test' ? 'false' : 'true')) ===
    'true';

if (enabled) {
    if (process.env.OTEL_DIAG_LOGGING === 'true') {
        diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.INFO);
    }

    const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318';

    try {
        const sdk = new NodeSDK({
            resource: resourceFromAttributes({
                [ATTR_SERVICE_NAME]:
                    process.env.OTEL_SERVICE_NAME ?? 'blockchain-transaction-simulator',
                [ATTR_SERVICE_VERSION]: process.env.APP_VERSION ?? 'unknown',
                'deployment.environment': process.env.NODE_ENV ?? 'development',
            }),
            traceExporter: new OTLPTraceExporter({
                url: `${endpoint}/v1/traces`,
            }),
            instrumentations: [
                new HttpInstrumentation(),
                // viem's http transport (used for all RPC calls to the
                // chain) goes through undici's fetch, not Node's legacy
                // http client — without this, every RPC span we create
                // manually in rpc.instrumentation.ts would be a leaf with
                // no visibility into the actual socket-level request/DNS/
                // TLS timing underneath it.
                new UndiciInstrumentation(),
                // @fastify/otel requires `registerOnInitialization: true`
                // to work via NodeSDK's auto-registration path — without
                // it, this instrumentation object does nothing at all
                // (it needs either that option, or a manual
                // `app.register(instrumentation.plugin())` call in
                // app.ts). See https://github.com/fastify/otel#registration-using-opentelemetry-node-sdk
                new FastifyOtelInstrumentation({ registerOnInitialization: true }),
                // BullMQ (the confirmation queue) and the outbox relay are
                // both built on ioredis; this gives visibility into queue
                // enqueue/dequeue calls without hand-instrumenting BullMQ.
                new IORedisInstrumentation(),
            ],
        });

        sdk.start();

        const shutdown = () => {
            sdk.shutdown().catch((error) => {
                // eslint-disable-next-line no-console
                console.error('otel.sdk.shutdown.failed', error);
            });
        };

        process.once('SIGTERM', shutdown);
        process.once('SIGINT', shutdown);
    } catch (error) {
        // If the SDK fails to even start, the process must still run —
        // this is observability tooling, not a business requirement.
        // eslint-disable-next-line no-console
        console.error('otel.sdk.start.failed — continuing without tracing', error);
    }
}
