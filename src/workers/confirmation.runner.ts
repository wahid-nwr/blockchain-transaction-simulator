import {
    startWorkerMetricsServer,
    stopWorkerMetricsServer,
    setWorkerReady,
} from './worker-metrics.server.js';
import { getLogger } from '../observability/logger.js';
import { fileURLToPath } from 'node:url';
import { WORKER_NAMES } from '../queues/worker.constants.js';

export async function startConfirmationWorker() {
    const metricsServer = startWorkerMetricsServer();

    const shutdown = async (signal: string) => {
        getLogger().info(
            {
                worker: WORKER_NAMES.CONFIRMATION,
                signal,
            },
            'worker.shutdown.requested',
        );

        try {
            setWorkerReady(false);

            await stopWorkerMetricsServer(metricsServer);

            getLogger().info(
                {
                    worker: WORKER_NAMES.CONFIRMATION,
                    signal,
                },
                'worker.shutdown.completed',
            );

            process.exit(0);
        } catch (error) {
            getLogger().info(
                {
                    worker: WORKER_NAMES.CONFIRMATION,
                    signal,
                    error: error instanceof Error ? error.message : String(error),
                },
                'worker.shutdown.failed',
            );

            process.exit(1);
        }
    };

    process.once('SIGINT', () => {
        void shutdown('SIGINT');
    });

    process.once('SIGTERM', () => {
        void shutdown('SIGTERM');
    });

    setWorkerReady(true);
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
    startConfirmationWorker().catch((error) => {
        getLogger().error(
            {
                worker: WORKER_NAMES.CONFIRMATION,
                error: error instanceof Error ? error.message : String(error),
            },
            'worker.crashed',
        );

        process.exit(1);
    });
}
