import { PendingRecoveryProcessor } from './pending-recovery.processor.js';
import { getLogger } from '../observability/logger.js';
import type { SchedulerLease } from '../scheduling/scheduler-lease.js';
import { incrementMetric, observeMetric } from '../observability/metrics.js';
import {
    workerCyclesTotal,
    workerFailuresTotal,
    workerDurationSeconds,
} from '../observability/worker.metrics.js';

export class PendingRecoveryScheduler {
    private static readonly NAME = 'pending-recovery-scheduler';
    private static readonly LEASE_TTL_MS = 60_000;

    private timer?: NodeJS.Timeout;
    private running = false;
    private executing = false;
    private leaseRenewTimer?: NodeJS.Timeout;

    constructor(
        private readonly processor: PendingRecoveryProcessor,
        private readonly lease: SchedulerLease,
        private readonly intervalMs = 30_000,
    ) {}

    start(): void {
        if (this.running) {
            return;
        }

        this.running = true;

        getLogger().info(
            {
                scheduler: PendingRecoveryScheduler.NAME,
                intervalMs: this.intervalMs,
            },
            'pending.recovery.scheduler.started',
        );

        this.timer = setInterval(() => {
            void this.run();
        }, this.intervalMs);
    }

    async stop(): Promise<void> {
        if (!this.running) {
            return;
        }

        this.running = false;

        if (this.timer) {
            clearInterval(this.timer);
            this.timer = undefined;
        }

        if (this.leaseRenewTimer) {
            clearInterval(this.leaseRenewTimer);
            this.leaseRenewTimer = undefined;
        }

        getLogger().info(
            {
                scheduler: PendingRecoveryScheduler.NAME,
            },
            'pending.recovery.scheduler.stopped',
        );
    }

    private async run(): Promise<void> {
        if (!this.running || this.executing) {
            return;
        }

        this.executing = true;

        let leaseAcquired = false;

        try {
            leaseAcquired = await this.lease.acquire(
                PendingRecoveryScheduler.NAME,
                PendingRecoveryScheduler.LEASE_TTL_MS,
            );

            if (!leaseAcquired) {
                return;
            }

            this.startLeaseRenewal();

            const cycleStartedAt = process.hrtime.bigint();

            try {
                await this.processor.processOrphanedPending();
            } catch (error) {
                incrementMetric(workerFailuresTotal, {
                    worker_name: PendingRecoveryScheduler.NAME,
                });
                throw error;
            } finally {
                incrementMetric(workerCyclesTotal, { worker_name: PendingRecoveryScheduler.NAME });
                observeMetric(
                    workerDurationSeconds,
                    Number(process.hrtime.bigint() - cycleStartedAt) / 1e9,
                    { worker_name: PendingRecoveryScheduler.NAME },
                );
            }
        } catch (error) {
            getLogger().error(
                {
                    scheduler: PendingRecoveryScheduler.NAME,
                    error: error instanceof Error ? error.message : String(error),
                },
                'pending.recovery.scheduler.failed',
            );
        } finally {
            this.stopLeaseRenewal();

            if (leaseAcquired) {
                try {
                    await this.lease.release(PendingRecoveryScheduler.NAME);
                } catch (error) {
                    getLogger().error(
                        {
                            scheduler: PendingRecoveryScheduler.NAME,
                            error: error instanceof Error ? error.message : String(error),
                        },
                        'pending.recovery.scheduler.lease.release.failed',
                    );
                }
            }

            this.executing = false;
        }
    }

    private startLeaseRenewal(): void {
        this.stopLeaseRenewal();

        const renewalIntervalMs = Math.floor(PendingRecoveryScheduler.LEASE_TTL_MS / 3);

        this.leaseRenewTimer = setInterval(() => {
            void this.renewLease();
        }, renewalIntervalMs);
    }

    private stopLeaseRenewal(): void {
        if (this.leaseRenewTimer) {
            clearInterval(this.leaseRenewTimer);
            this.leaseRenewTimer = undefined;
        }
    }

    private async renewLease(): Promise<void> {
        try {
            const renewed = await this.lease.renew(
                PendingRecoveryScheduler.NAME,
                PendingRecoveryScheduler.LEASE_TTL_MS,
            );

            if (!renewed) {
                getLogger().warn(
                    {
                        scheduler: PendingRecoveryScheduler.NAME,
                    },
                    'pending.recovery.scheduler.lease.renew.failed',
                );
            }
        } catch (error) {
            getLogger().error(
                {
                    scheduler: PendingRecoveryScheduler.NAME,
                    error: error instanceof Error ? error.message : String(error),
                },
                'pending.recovery.scheduler.lease.renew.error',
            );
        }
    }
}
