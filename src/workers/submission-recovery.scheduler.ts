import { SubmissionRecoveryProcessor } from './submission-recovery.processor.js';
import { getLogger } from '../observability/logger.js';

export class SubmissionRecoveryScheduler {
    private static readonly NAME = 'submission-recovery-scheduler';

    private timer?: NodeJS.Timeout;
    private running = false;
    private executing = false;

    constructor(
        private readonly processor: SubmissionRecoveryProcessor,
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

        try {
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
            this.executing = false;
        }
    }
}
