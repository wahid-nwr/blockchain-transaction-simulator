import { Counter, Histogram } from 'prom-client';
import { registerMetric } from './metrics.js';

export const rpcRequestsTotal = registerMetric(
    new Counter({
        name: 'blockchain_rpc_requests_total',
        help: 'Total blockchain RPC requests.',
        labelNames: ['method', 'status'],
        registers: [],
    }),
);

export const rpcFailuresTotal = registerMetric(
    new Counter({
        name: 'blockchain_rpc_failures_total',
        help: 'Total blockchain RPC failures grouped by reason.',
        labelNames: ['method', 'reason'],
        registers: [],
    }),
);

export const rpcRetriesTotal = registerMetric(
    new Counter({
        name: 'blockchain_rpc_retries_total',
        help: 'Total blockchain RPC retry attempts.',
        labelNames: ['method'],
        registers: [],
    }),
);

export const rpcDurationSeconds = registerMetric(
    new Histogram({
        name: 'blockchain_rpc_duration_seconds',
        help: 'Blockchain RPC request duration.',
        labelNames: ['method'],
        buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5],
        registers: [],
    }),
);

export function recordRpcRetry(method: string): void {
    rpcRetriesTotal.inc({
        method,
    });
}

export function recordRpcFailure(
    method: string,
    reason: string,
): void {
    rpcFailuresTotal.inc({
        method,
        reason,
    });
}