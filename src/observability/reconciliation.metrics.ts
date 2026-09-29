import { Gauge } from 'prom-client';
import { registerMetric } from './metrics.js';

/**
 * Outcome of checking one BalanceSnapshot against the chain.
 *
 * match             — snapshot agrees with the chain at the indexer's frontier.
 * drift             — snapshot disagrees even though the indexer claims to have
 *                     processed that far. Real ledger incorrectness.
 * stale_observation — the snapshot advanced past the position we read (the
 *                     indexer moved during the check). Harmless; re-checked
 *                     next sweep.
 * unverified        — could not be checked (no cursor yet, RPC failure,
 *                     unsupported chain capability, ...). Not evidence of
 *                     drift, but not evidence of health either.
 */
export const BALANCE_CHECK_RESULTS = ['match', 'drift', 'stale_observation', 'unverified'] as const;

export type BalanceCheckResult = (typeof BALANCE_CHECK_RESULTS)[number];

/**
 * Snapshot counts from the most recently COMPLETED sweep. A gauge rather
 * than a counter on purpose: "how many snapshots are drifted right now" is
 * the thing to alert on, and it must fall back to 0 when drift is repaired.
 * Labelled by blockchain only — wallet/token IDs would be unbounded
 * cardinality and live in the `balance.drift.detected` log line instead.
 */
export const balanceReconciliationSnapshots = registerMetric(
    new Gauge({
        name: 'balance_reconciliation_snapshots',
        help: 'Balance snapshots by reconciliation result, from the last completed drift sweep.',
        labelNames: ['blockchain', 'result'],
        registers: [],
    }),
);

/**
 * Unix time the last sweep FINISHED (every snapshot visited). Not advanced
 * by a sweep that throws part-way, so `time() - this` is a true "the safety
 * net has stopped" signal.
 */
export const balanceReconciliationLastSweepTimestamp = registerMetric(
    new Gauge({
        name: 'balance_reconciliation_last_sweep_timestamp_seconds',
        help: 'Unix timestamp of the last completed balance drift sweep.',
        registers: [],
    }),
);
