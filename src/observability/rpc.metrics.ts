import { Counter, Histogram } from 'prom-client';
import { registerMetric } from './metrics.js';

export const rpcSuccess = registerMetric(
    new Counter({
        name: 'blockchain_rpc_requests_total',
        help: 'Total blockchain RPC requests',
        labelNames: ['method', 'status'],
        registers: [],
    }),
);

export const rpcFailures = registerMetric(
    new Counter({
        name: 'blockchain_rpc_failures_total',
        help: 'Total blockchain RPC failures',
        labelNames: ['method'],
        registers: [],
    }),
);

export const rpcDuration = registerMetric(
    new Histogram({
        name: 'blockchain_rpc_duration_seconds',
        help: 'Blockchain RPC request duration',
        labelNames: ['method'],
        buckets: [0.05, 0.1, 0.5, 1, 2, 5],
        registers: [],
    }),
);
