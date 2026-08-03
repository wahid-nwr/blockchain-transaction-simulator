import fp from 'fastify-plugin';
import { FastifyPluginAsync } from 'fastify';
import { runWithContext } from '../../observability/context.js';

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
        request.log.info(
            {
                statusCode: reply.statusCode,

                durationMs: Number(process.hrtime.bigint() - request.startTime!) / 1_000_000,
            },
            'request completed',
        );
    });
};

export const observabilityPlugin = fp(plugin);
