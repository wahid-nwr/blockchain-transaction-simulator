import { Counter, Histogram, Gauge } from 'prom-client';
import { registerMetric } from './metrics.js';

export const workerCyclesTotal = registerMetric(
    new Counter({
        name: 'worker_cycles_total',
        help: 'Total number of worker execution cycles',
        labelNames: ['worker_name'],
        registers: [],
    }),
);

export const workerFailuresTotal = registerMetric(
    new Counter({
        name: 'worker_failures_total',
        help: 'Total number of worker execution failures',
        labelNames: ['worker_name'],
        registers: [],
    }),
);

export const workerDurationSeconds = registerMetric(
    new Histogram({
        name: 'worker_duration_seconds',
        help: 'Worker execution duration in seconds',
        labelNames: ['worker_name'],
        registers: [],
        buckets: [0.1, 0.5, 1, 5, 10, 30, 60],
    }),
);

export const workerReady = new Gauge({
    name: 'worker_ready',
    help: 'Whether the worker is ready to process jobs.',
    labelNames: ['worker_name'],
    registers: [],
});

export const confirmationWorkerPendingTransactions = new Gauge({
    name: 'confirmation_worker_pending_transactions',
    help: 'Number of pending transactions waiting for confirmation.',
    registers: [],
});
