import { TransactionRepository } from '../repositories/transaction.repository.js';
import { ConfirmationWorker } from './confirmation.worker.js';
import {
    startWorkerMetricsServer,
    stopWorkerMetricsServer,
    setWorkerReady,
} from './worker-metrics.server.js';
import { getLogger } from '../observability/logger.js';

export async function startConfirmationWorker() {
    const metricsServer = startWorkerMetricsServer();

    const worker = new ConfirmationWorker(new TransactionRepository());

    const shutdown = async (signal: string) => {
        getLogger().info(
            {
                worker: 'confirmation-worker',
                signal,
            },
            'worker.shutdown.requested',
        );

        try {
            setWorkerReady(false);

            await worker.stop();

            await stopWorkerMetricsServer(metricsServer);

            getLogger().info(
                {
                    worker: 'confirmation-worker',
                    signal,
                },
                'worker.shutdown.completed',
            );

            process.exit(0);
        } catch (error) {
            getLogger().info(
                {
                    worker: 'confirmation-worker',
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

    await worker.start();
}

if (import.meta.url === `file://${process.argv[1]}`) {
    startConfirmationWorker().catch((error) => {
        getLogger().warn(
            {
                worker: 'confirmation-worker',
                error: error instanceof Error ? error.message : String(error),
            },
            'worker.crashed',
        );

        process.exit(1);
    });
}
