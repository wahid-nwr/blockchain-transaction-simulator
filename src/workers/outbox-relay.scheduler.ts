import { OutboxEventService } from '../services/outbox-event.service.js';
import { getLogger } from '../observability/logger.js';
import type { SchedulerLease } from '../scheduling/scheduler-lease.js';

export class OutboxRelayScheduler {
private static readonly NAME = 'outbox-relay-scheduler';
private static readonly LEASE_TTL_MS = 30_000;

private timer?: NodeJS.Timeout;
private running = false;
private executing = false;
private leaseRenewTimer?: NodeJS.Timeout;

constructor(
        private readonly outboxService: OutboxEventService,
        private readonly lease: SchedulerLease,
        private readonly intervalMs = 5_000,
    ) {}

    start(): void {
        if (this.running) {
            return;
        }

        this.running = true;

        getLogger().info(
            {
                scheduler: OutboxRelayScheduler.NAME,
                intervalMs: this.intervalMs,
            },
            'outbox.relay.scheduler.started',
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
            { scheduler: OutboxRelayScheduler.NAME },
            'outbox.relay.scheduler.stopped',
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
                OutboxRelayScheduler.NAME,
                OutboxRelayScheduler.LEASE_TTL_MS,
            );

            if (!leaseAcquired) {
                return;
            }

            this.startLeaseRenewal();

            const count = await this.outboxService.relay();

            if (count > 0) {
                getLogger().info(
                    { scheduler: OutboxRelayScheduler.NAME, relayed: count },
                    'outbox.relay.scheduler.tick',
                );
            }
        } catch (error) {
            getLogger().error(
                {
                    scheduler: OutboxRelayScheduler.NAME,
                    error: error instanceof Error ? error.message : String(error),
                },
                'outbox.relay.scheduler.failed',
            );
        } finally {
            this.stopLeaseRenewal();

            if (leaseAcquired) {
                try {
                    await this.lease.release(OutboxRelayScheduler.NAME);
                } catch (error) {
                    getLogger().error(
                        {
                            scheduler: OutboxRelayScheduler.NAME,
                            error: error instanceof Error ? error.message : String(error),
                        },
                        'outbox.relay.scheduler.lease.release.failed',
                    );
                }
            }

            this.executing = false;
        }
    }

    private startLeaseRenewal(): void {
        this.stopLeaseRenewal();

        const renewalIntervalMs = Math.floor(OutboxRelayScheduler.LEASE_TTL_MS / 3);

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
                OutboxRelayScheduler.NAME,
                OutboxRelayScheduler.LEASE_TTL_MS,
            );

            if (!renewed) {
                getLogger().warn(
                    { scheduler: OutboxRelayScheduler.NAME },
                    'outbox.relay.scheduler.lease.renew.failed',
                );
            }
        } catch (error) {
            getLogger().error(
                {
                    scheduler: OutboxRelayScheduler.NAME,
                    error: error instanceof Error ? error.message : String(error),
                },
                'outbox.relay.scheduler.lease.renew.error',
            );
        }
    }
}