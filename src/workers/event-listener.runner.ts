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

    process.on('SIGTERM', () => void shutdown('SIGTERM'));

    process.on('SIGINT', () => void shutdown('SIGINT'));

    if (process.env.DISABLE_WORKERS !== 'true') {
        await worker.start(Number(process.env.EVENT_LISTENER_INTERVAL_MS ?? 5000));
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
