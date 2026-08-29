import { confirmationWorkerPendingTransactions } from '../observability/worker.metrics.js';
import { getLogger } from '../observability/logger.js';
import { TransactionRepository } from '../repositories/transaction.repository.js';

const DEFAULT_INTERVAL_MS = 15_000;

/**
* Periodically samples the count of PENDING transactions and publishes it
* as `confirmation_worker_pending_transactions`.
*
* This is deliberately a simple read-only poll, not a scheduler-lease-based
* component like ExpirationScheduler/SubmissionRecoveryScheduler: it does
* no mutating work, so there's no coordination problem to solve. If several
* worker replicas run this concurrently, they all report the same
* fleet-wide count — Prometheus just sees that value once per instance,
* which is harmless (and arguably useful as a liveness signal per replica).
*/
export class PendingTransactionsSampler {
private timer: NodeJS.Timeout | undefined;

constructor(
        private readonly repository: TransactionRepository,
        private readonly intervalMs: number = DEFAULT_INTERVAL_MS,
    ) {}

    start(): void {
        // Sample immediately on start rather than waiting a full interval,
        // so the gauge isn't reporting a stale zero right after a deploy.
        void this.sample();

        this.timer = setInterval(() => void this.sample(), this.intervalMs);
        this.timer.unref();
    }

    stop(): void {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = undefined;
        }
    }

    private async sample(): Promise<void> {
        try {
            const count = await this.repository.countPending();

            confirmationWorkerPendingTransactions.set(count);
        } catch (error) {
            // A failed sample must not crash the worker or affect
            // confirmation processing — it just leaves the gauge stale
            // until the next tick.
            getLogger().error(
                {
                    error: error instanceof Error ? error.message : String(error),
                },
                'pending.transactions.sample.failed',
            );
        }
    }
}