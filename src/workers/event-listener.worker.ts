import { prisma } from '../database/prisma.js';
import { processTokenEvents } from './event.listener.js';
import { logger } from '../utils/logger.js';
import {
    eventListenerCyclesTotal,
    eventListenerFailuresTotal,
    eventListenerDuration,
} from '../metrics/event-listener.metrics.js';

export class EventListenerWorker {
    private running = false;

    private stopping = false;

    async start(interval = 5000) {
        if (this.running) {
            throw new Error('Event listener worker already running');
        }

        this.running = true;
        this.stopping = false;

        logger.info('Event listener worker started');

        while (this.running) {
            try {
                await this.processCycle();
            } catch (error) {
                logger.error(
                    {
                        error,
                    },
                    'Event listener cycle failed',
                );
            }

            if (this.running) {
                await this.delay(interval);
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

    async processCycle() {
        const timer = eventListenerDuration.startTimer();

        eventListenerCyclesTotal.inc();

        try {
            const tokens = await prisma.token.findMany();

            for (const token of tokens) {
                try {
                    await processTokenEvents(token.id);
                } catch (error) {
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
