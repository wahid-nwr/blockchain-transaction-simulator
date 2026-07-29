import { createServer } from 'node:http';
import { registry } from '../observability/metrics.js';

const PORT = Number(process.env.WORKER_METRICS_PORT ?? 3001);

export function startMetricsServer() {
    const server = createServer(async (req, res) => {
        if (req.url !== '/metrics') {
            res.statusCode = 404;
            res.end('Not Found');
            return;
        }

        try {
            const metrics = await registry.metrics();

            res.writeHead(200, {
                'Content-Type': registry.contentType,
            });

            res.end(metrics);
        } catch (error) {
            res.writeHead(500, {
                'Content-Type': 'text/plain',
            });

            res.end('Failed to collect metrics');
        }
    });

    server.listen(PORT, () => {
        console.log(`Worker metrics server listening on port ${PORT}`);
    });

    return server;
}
