import { Counter, Histogram } from 'prom-client';

import { registerMetric } from './metrics.js';

export const transactionsCreatedTotal = registerMetric(
    new Counter({
        name: 'transactions_created_total',
        help: 'Total number of transactions created',
        labelNames: ['tenantId', 'tokenId'],
        registers: [],
    }),
);

export const transactionsSubmittedTotal = registerMetric(
    new Counter({
        name: 'transactions_submitted_total',
        help: 'Total number of transactions submitted to blockchain',
        labelNames: ['tenantId', 'tokenId'],
        registers: [],
    }),
);

export const transactionsConfirmedTotal = registerMetric(
    new Counter({
        name: 'transactions_confirmed_total',
        help: 'Total number of confirmed transactions',
        labelNames: ['tenantId', 'tokenId'],
        registers: [],
    }),
);

export const transactionsFailedTotal = registerMetric(
    new Counter({
        name: 'transactions_failed_total',
        help: 'Total number of failed transactions',
        labelNames: ['tenantId', 'tokenId', 'status'],
        registers: [],
    }),
);

export const transactionsRevertedTotal = registerMetric(
    new Counter({
        name: 'transactions_reverted_total',
        help: 'Total number of blockchain reverted transactions',
        labelNames: ['tenantId', 'tokenId'],
        registers: [],
    }),
);

export const transactionSubmissionDurationSeconds = registerMetric(
    new Histogram({
        name: 'transaction_submission_duration_seconds',
        help: 'Time taken to submit blockchain transactions',
        labelNames: ['tenantId', 'tokenId'],
        registers: [],
        buckets: [0.1, 0.5, 1, 2, 5, 10, 30],
    }),
);

export const transactionConfirmationDurationSeconds = registerMetric(
    new Histogram({
        name: 'transaction_confirmation_duration_seconds',
        help: 'Time taken for blockchain transaction confirmation',
        labelNames: ['tenantId', 'tokenId'],
        registers: [],
        buckets: [1, 5, 10, 30, 60, 120, 300],
    }),
);
