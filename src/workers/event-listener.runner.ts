import { EventListenerWorker } from './event-listener.worker.js';
import { logger } from '../utils/logger.js';

export async function startEventListenerWorker() {
    const worker = new EventListenerWorker();

    const shutdown = async (signal: string) => {
        logger.info(
            {
                signal,
            },
            'Shutdown signal received',
        );

        await worker.stop();

        process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));

    process.on('SIGINT', () => shutdown('SIGINT'));

    if (process.env.DISABLE_WORKERS !== 'true') {
        await worker.start();
    }
}

if (import.meta.url === `file://${process.argv[1]}`) {
    startEventListenerWorker().catch((error) => {
        logger.error(
            {
                error,
            },
            'Worker crashed',
        );

        process.exit(1);
    });
}
