import { ExpirationProcessor } from './expiration.processor.js';
import { getLogger } from '../observability/logger.js';
import { CONFIRMATION_TIMEOUT_MS } from '../domain/transaction/transaction-expiration.js';

export class ExpirationScheduler {
    private static readonly NAME = 'expiration-scheduler';

    private timer?: NodeJS.Timeout;
    private running = false;
    private executing = false;

    constructor(
        private readonly processor: ExpirationProcessor,
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

        try {
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
            this.executing = false;
        }
    }
}
