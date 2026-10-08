import { prisma } from '../database/prisma.js';
import { processTokenEvents } from './event.listener.js';
import { logger } from '../utils/logger.js';
import {
    eventListenerCyclesTotal,
    eventListenerFailuresTotal,
    eventListenerDuration,
} from '../metrics/event-listener.metrics.js';

const MAX_BACKOFF_MS = 60_000;

/**
 * Delay before the next cycle. Normally the configured interval; after
 * consecutive failed cycles it doubles each time (capped at a minute, and never
 * below the interval itself). On a rate-limited public RPC, retrying at a fixed
 * short interval only deepens the throttling.
 */
export function backoffDelay(baseMs: number, consecutiveFailures: number): number {
    if (consecutiveFailures <= 0) {
        return baseMs;
    }

    const doubled = baseMs * 2 ** Math.min(consecutiveFailures, 10);

    return Math.min(doubled, Math.max(baseMs, MAX_BACKOFF_MS));
}

export class EventListenerWorker {
    private running = false;

    private stopping = false;

    async start(interval = Number(process.env.EVENT_LISTENER_INTERVAL_MS ?? 5000)) {
        if (this.running) {
            throw new Error('Event listener worker already running');
        }

        if (!Number.isFinite(interval) || interval < 0) {
            throw new Error(
                `Invalid EVENT_LISTENER_INTERVAL_MS: ${process.env.EVENT_LISTENER_INTERVAL_MS}`,
            );
        }

        this.running = true;
        this.stopping = false;

        logger.info(
            {
                intervalMs: interval,
            },
            'Event listener worker started',
        );

        let consecutiveFailures = 0;

        while (this.running) {
            let cycleFailed = false;

            try {
                const { failedTokens } = await this.processCycle();

                cycleFailed = failedTokens > 0;
            } catch (error) {
                cycleFailed = true;

                logger.error(
                    {
                        error,
                    },
                    'Event listener cycle failed',
                );
            }

            consecutiveFailures = cycleFailed ? consecutiveFailures + 1 : 0;

            if (this.running) {
                const delayMs = backoffDelay(interval, consecutiveFailures);

                if (delayMs > interval) {
                    logger.warn(
                        {
                            consecutiveFailures,
                            delayMs,
                        },
                        'Event listener backing off after failed cycles',
                    );
                }

                await this.delay(delayMs);
            }
        }

        logger.info('Event listener worker stopped');
    }

    async stop() {
        if (!this.running || this.stopping) {
            return;
        }

        this.stopping = true;

        logger.info('Stopping event listener worker');

        this.running = false;
    }

    isRunning() {
        return this.running;
    }

    async processCycle(): Promise<{ failedTokens: number }> {
        const timer = eventListenerDuration.startTimer();

        let failedTokens = 0;

        eventListenerCyclesTotal.inc();

        try {
            const tokens = await prisma.token.findMany();

            for (const token of tokens) {
                try {
                    await processTokenEvents(token.id);
                } catch (error) {
                    failedTokens += 1;

                    eventListenerFailuresTotal.inc();

                    logger.error(
                        {
                            tokenId: token.id,
                            error,
                        },
                        'Token event processing failed',
                    );
                }
            }

            return { failedTokens };
        } catch (error) {
            eventListenerFailuresTotal.inc();

            throw error;
        } finally {
            timer();
        }
    }

    private delay(ms: number) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}
