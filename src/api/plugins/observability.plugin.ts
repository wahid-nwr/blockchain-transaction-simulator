import fp from 'fastify-plugin';
import { FastifyPluginAsync } from 'fastify';
import { runWithContext } from '../../observability/context.js';
import { incrementMetric, observeMetric } from '../../observability/metrics.js';
import { httpRequestsTotal, httpRequestDurationSeconds } from '../../observability/http.metrics.js';

const plugin: FastifyPluginAsync = async (app) => {
    app.addHook('onRequest', (request, reply, done) => {
        const requestId = request.headers['x-request-id']?.toString() ?? request.id;

        reply.header('x-request-id', requestId);

        request.startTime = process.hrtime.bigint();

        runWithContext(
            {
                correlationId: requestId,
                requestId,
            },
            () => {
                request.log.info(
                    {
                        method: request.method,
                        url: request.url,
                    },
                    'request started',
                );

                done();
            },
        );
    });

    app.addHook('onResponse', async (request, reply) => {
        const durationMs = Number(process.hrtime.bigint() - request.startTime!) / 1_000_000;

        request.log.info(
            {
                statusCode: reply.statusCode,

                durationMs,
            },
            'request completed',
        );

        // Route *pattern*, not the raw URL (request.url) — otherwise a
        // route like /api/v1/transactions/:id would generate one metric
        // series per transaction id ever requested. Falls back to the raw
        // URL for genuinely unmatched routes (404s) since there's no
        // pattern to use there, and 404 volume/route is itself useful.
        const route = request.routeOptions?.url ?? request.url;
        const labels = {
            method: request.method,
            route,
            status_code: String(reply.statusCode),
        };

        incrementMetric(httpRequestsTotal, labels);
        observeMetric(httpRequestDurationSeconds, durationMs / 1000, labels);
    });
};

export const observabilityPlugin = fp(plugin);
