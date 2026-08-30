import { Counter, Histogram } from 'prom-client';
import { registerMetric } from './metrics.js';

/**
 * Route-pattern (not raw URL) labeled HTTP request metrics.
 *
 * These didn't exist before this file was added — every other metric in
 * this codebase measures something *downstream* of the API layer
 * (RPC calls, worker cycles, transaction lifecycle), so there was no way to
 * answer "is the API itself fast and available" at all. That's the
 * prerequisite for the API latency/availability SLO in docs/slo.md.
 *
 * Labeled by route *pattern* (e.g. `/api/v1/transactions/:id`), never the
 * raw request URL — using the raw URL would make cardinality unbounded
 * (one series per transaction id ever requested).
 */
export const httpRequestsTotal = registerMetric(
    new Counter({
        name: 'http_requests_total',
        help: 'Total HTTP requests handled by the API, labeled by route pattern and status code.',
        labelNames: ['method', 'route', 'status_code'],
        registers: [],
    }),
);

export const httpRequestDurationSeconds = registerMetric(
    new Histogram({
        name: 'http_request_duration_seconds',
        help: 'HTTP request duration in seconds, labeled by route pattern and status code.',
        labelNames: ['method', 'route', 'status_code'],
        buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
        registers: [],
    }),
);
