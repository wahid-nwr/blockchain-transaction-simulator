import { prisma } from '../database/prisma.js';
import { processTokenEvents } from './event.listener.js';
import { logger } from '../utils/logger.js';

export class EventListenerWorker {
    private running = false;

    async start(interval = 5000) {
        this.running = true;

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

            await this.delay(interval);
        }
    }

    stop() {
        this.running = false;
    }

    private async processCycle() {
        const tokens = await prisma.token.findMany();

        for (const token of tokens) {
            await processTokenEvents(token.id);
        }
    }

    private delay(ms: number) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}
