import { ExpirationProcessor } from './expiration.processor.js';
import { getLogger } from '../observability/logger.js';
import { CONFIRMATION_TIMEOUT_MS } from '../domain/transaction/transaction-expiration.js';
import type { SchedulerLease } from '../scheduling/scheduler-lease.js';

export class ExpirationScheduler {
    private static readonly NAME = 'expiration-scheduler';
    private static readonly LEASE_TTL_MS = 60_000;

    private timer?: NodeJS.Timeout;
    private running = false;
    private executing = false;
    private leaseRenewTimer?: NodeJS.Timeout;

    constructor(
        private readonly processor: ExpirationProcessor,
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
                scheduler: ExpirationScheduler.NAME,
                intervalMs: this.intervalMs,
            },
            'expiration.scheduler.started',
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
                scheduler: ExpirationScheduler.NAME,
            },
            'expiration.scheduler.stopped',
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
                ExpirationScheduler.NAME,
                ExpirationScheduler.LEASE_TTL_MS,
            );

            if (!leaseAcquired) {
                return;
            }

            this.startLeaseRenewal();

            const expirationBefore = new Date(Date.now() - CONFIRMATION_TIMEOUT_MS);

            await this.processor.processExpiredTransactions(expirationBefore);
        } catch (error) {
            getLogger().error(
                {
                    scheduler: ExpirationScheduler.NAME,
                    error: error instanceof Error ? error.message : String(error),
                },
                'expiration.scheduler.failed',
            );
        } finally {
            this.stopLeaseRenewal();

            if (leaseAcquired) {
                try {
                    await this.lease.release(ExpirationScheduler.NAME);
                } catch (error) {
                    getLogger().error(
                        {
                            scheduler: ExpirationScheduler.NAME,
                            error: error instanceof Error ? error.message : String(error),
                        },
                        'expiration.scheduler.lease.release.failed',
                    );
                }
            }

            this.executing = false;
        }
    }

    private startLeaseRenewal(): void {
        this.stopLeaseRenewal();

        const renewalIntervalMs = Math.floor(ExpirationScheduler.LEASE_TTL_MS / 3);

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
                ExpirationScheduler.NAME,
                ExpirationScheduler.LEASE_TTL_MS,
            );

            if (!renewed) {
                getLogger().warn(
                    {
                        scheduler: ExpirationScheduler.NAME,
                    },
                    'expiration.scheduler.lease.renew.failed',
                );
            }
        } catch (error) {
            getLogger().error(
                {
                    scheduler: ExpirationScheduler.NAME,
                    error: error instanceof Error ? error.message : String(error),
                },
                'expiration.scheduler.lease.renew.error',
            );
        }
    }
}
