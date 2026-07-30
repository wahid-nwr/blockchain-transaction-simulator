import { createServer, type Server } from 'node:http';

import { registry } from '../observability/metrics.js';
import { getLogger } from '../observability/logger.js';

const PORT = Number(process.env.WORKER_METRICS_PORT ?? 3001);

let ready = false;

export function setWorkerReady(value: boolean) {
    ready = value;
}

export function isWorkerReady() {
    return ready;
}

export function startWorkerMetricsServer(): Server {
    const server = createServer(async (req, res) => {
        if (req.url === '/metrics') {
            try {
                const metrics = await registry.metrics();

                res.writeHead(200, {
                    'Content-Type': registry.contentType,
                });

                res.end(metrics);
                return;
            } catch (error) {
                getLogger().warn({ error }, 'worker.metrics.error');
                res.writeHead(500, {
                    'Content-Type': 'text/plain',
                });

                res.end('Failed to collect metrics');

                return;
            }
        }

        if (req.url === '/health') {
            res.writeHead(ready ? 200 : 503, {
                'Content-Type': 'application/json',
            });

            res.end(
                JSON.stringify({
                    status: ready ? 'UP' : 'DOWN',
                }),
            );

            return;
        }

        res.writeHead(404, {
            'Content-Type': 'text/plain',
        });

        res.end('Not Found');
    });

    server.listen(PORT, () => {
        getLogger().info(
            {
                port: PORT,
            },
            'worker.metrics.started',
        );
    });

    return server;
}

export async function stopWorkerMetricsServer(server: Server): Promise<void> {
    await new Promise<void>((resolve, reject) => {
        server.close((error) => {
            if (error) {
                reject(error);
                return;
            }

            resolve();
        });
    });

    getLogger().info(
        {
            port: PORT,
        },
        'worker.metrics.stopped',
    );
}
