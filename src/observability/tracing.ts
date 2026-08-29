import {
    trace,
    context as otelContext,
    SpanStatusCode,
    type Span as OtelSpan,
} from '@opentelemetry/api';
import { getLogger } from './logger.js';

export interface Span {
    end(): void;

    setAttribute(key: string, value: string | number | boolean): void;

    addEvent(name: string, attributes?: Record<string, unknown>): void;

    recordException(error: unknown): void;

    setStatus(status: 'ok' | 'error'): void;
}

/**
 * Every method below is wrapped defensively: a tracing failure (bad
 * attribute value, exporter hiccup, SDK not initialized) must never break
 * the business logic it's wrapping. This mirrors the fail-safe pattern
 * already used by incrementMetric/observeMetric in metrics.ts.
 */
class OtelSpanAdapter implements Span {
    constructor(private readonly span: OtelSpan) {}

    end(): void {
        try {
            this.span.end();
        } catch (error) {
            getLogger().warn({ error }, 'tracing.span.end.failed');
        }
    }

    setAttribute(key: string, value: string | number | boolean): void {
        try {
            this.span.setAttribute(key, value);
        } catch (error) {
            getLogger().warn({ error }, 'tracing.span.setAttribute.failed');
        }
    }

    addEvent(name: string, attributes?: Record<string, unknown>): void {
        try {
            this.span.addEvent(name, attributes as Record<string, string | number | boolean>);
        } catch (error) {
            getLogger().warn({ error }, 'tracing.span.addEvent.failed');
        }
    }

    recordException(error: unknown): void {
        try {
            this.span.recordException(error instanceof Error ? error : String(error));
        } catch (recordError) {
            getLogger().warn({ error: recordError }, 'tracing.span.recordException.failed');
        }
    }

    setStatus(status: 'ok' | 'error'): void {
        try {
            this.span.setStatus({
                code: status === 'ok' ? SpanStatusCode.OK : SpanStatusCode.ERROR,
            });
        } catch (error) {
            getLogger().warn({ error }, 'tracing.span.setStatus.failed');
        }
    }
}

/**
 * No-op fallback used when span creation itself throws (e.g. the SDK
 * hasn't been initialized, such as in unit tests that import this module
 * directly without loading observability/otel-preload.ts first). Tracing
 * is a pure enhancement — call sites should never need to know whether it's
 * actually wired up.
 */
class NoopSpan implements Span {
    end(): void {}

    setAttribute(): void {}

    addEvent(): void {}

    recordException(): void {}

    setStatus(): void {}
}

const tracer = trace.getTracer('blockchain-transaction-simulator');

/**
 * Starts a span parented to whatever span is currently active (OpenTelemetry's
 * ambient `context.active()`), or as a root span if none is. Callers are
 * responsible for calling `span.end()` — typically in a `finally` block —
 * mirroring the existing Span interface's manual lifecycle rather than
 * switching to a callback-based API, to keep this a drop-in upgrade for the
 * previous no-op implementation.
 *
 * IMPORTANT: calling startSpan() does NOT itself make the returned span the
 * active one for code that runs after it — OpenTelemetry's JS context model
 * is push/pop (`context.with(ctx, fn)`), not "enter and stay". A span
 * created here will correctly parent under an *existing* active span (e.g.
 * one started via withSpan() further up the call stack), but if you need
 * spans created *underneath* this one to nest under it, use withSpan()
 * instead so the active context is actually propagated across the awaited
 * work.
 */
export function startSpan(
    name: string,
    attributes: Record<string, string | number | boolean> = {},
): Span {
    try {
        return new OtelSpanAdapter(tracer.startSpan(name, { attributes }));
    } catch (error) {
        getLogger().warn({ error, span: name }, 'tracing.span.start.failed');

        return new NoopSpan();
    }
}

/**
 * Runs `fn` with `span` active as the current span, so any spans it starts
 * nest correctly underneath it. Use this instead of a bare startSpan/end
 * pair whenever the traced work spans an `await` boundary and you want
 * children (e.g. RPC spans inside a transaction-confirmation span) to
 * parent correctly — plain sequential `startSpan()` calls don't establish
 * a parent/child relationship on their own.
 */
export async function withSpan<T>(
    name: string,
    fn: (span: Span) => Promise<T>,
    attributes: Record<string, string | number | boolean> = {},
): Promise<T> {
    const otelSpan = tracer.startSpan(name, { attributes });
    const span = new OtelSpanAdapter(otelSpan);
    const activeContext = trace.setSpan(otelContext.active(), otelSpan);

    return otelContext.with(activeContext, async () => {
        try {
            const result = await fn(span);

            span.setStatus('ok');

            return result;
        } catch (error) {
            span.recordException(error);
            span.setStatus('error');

            throw error;
        } finally {
            span.end();
        }
    });
}

/**
 * Returns the active trace/span id, when tracing is initialized and a
 * span is active. Used to correlate log lines with the trace they belong
 * to (see logger.ts) — this is what actually connects "read the logs" and
 * "read the trace" into one investigation instead of two.
 */
export function getActiveTraceContext(): { traceId?: string; spanId?: string } {
    try {
        const activeSpan = trace.getSpan(otelContext.active());
        const spanContext = activeSpan?.spanContext();

        if (!spanContext || !trace.isSpanContextValid(spanContext)) {
            return {};
        }

        return {
            traceId: spanContext.traceId,
            spanId: spanContext.spanId,
        };
    } catch {
        return {};
    }
}
