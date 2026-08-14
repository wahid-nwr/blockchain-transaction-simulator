import { SubmissionRecoveryProcessor } from './submission-recovery.processor.js';
import { getLogger } from '../observability/logger.js';
import type { SchedulerLease } from '../scheduling/scheduler-lease.js';

export class SubmissionRecoveryScheduler {
    private static readonly NAME = 'submission-recovery-scheduler';
    private static readonly LEASE_TTL_MS = 60_000;

    private timer?: NodeJS.Timeout;
    private running = false;
    private executing = false;
    private leaseRenewTimer?: NodeJS.Timeout;

    constructor(
        private readonly processor: SubmissionRecoveryProcessor,
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
                scheduler: SubmissionRecoveryScheduler.NAME,
                intervalMs: this.intervalMs,
            },
            'submission.recovery.scheduler.started',
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
                scheduler: SubmissionRecoveryScheduler.NAME,
            },
            'submission.recovery.scheduler.stopped',
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
                SubmissionRecoveryScheduler.NAME,
                SubmissionRecoveryScheduler.LEASE_TTL_MS,
            );

            if (!leaseAcquired) {
                return;
            }

            this.startLeaseRenewal();
            await this.processor.processSubmittedTransactions();
        } catch (error) {
            getLogger().error(
                {
                    scheduler: SubmissionRecoveryScheduler.NAME,
                    error: error instanceof Error ? error.message : String(error),
                },
                'submission.recovery.scheduler.failed',
            );
        } finally {
            this.stopLeaseRenewal();

            if (leaseAcquired) {
                try {
                    await this.lease.release(SubmissionRecoveryScheduler.NAME);
                } catch (error) {
                    getLogger().error(
                        {
                            scheduler: SubmissionRecoveryScheduler.NAME,
                            error: error instanceof Error ? error.message : String(error),
                        },
                        'submission.recovery.scheduler.lease.release.failed',
                    );
                }
            }

            this.executing = false;
        }
    }

    private startLeaseRenewal(): void {
        this.stopLeaseRenewal();

        const renewalIntervalMs = Math.floor(SubmissionRecoveryScheduler.LEASE_TTL_MS / 3);

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
                SubmissionRecoveryScheduler.NAME,
                SubmissionRecoveryScheduler.LEASE_TTL_MS,
            );

            if (!renewed) {
                getLogger().warn(
                    {
                        scheduler: SubmissionRecoveryScheduler.NAME,
                    },
                    'submission.recovery.scheduler.lease.renew.failed',
                );
            }
        } catch (error) {
            getLogger().error(
                {
                    scheduler: SubmissionRecoveryScheduler.NAME,
                    error: error instanceof Error ? error.message : String(error),
                },
                'submission.recovery.scheduler.lease.renew.error',
            );
        }
    }
}
