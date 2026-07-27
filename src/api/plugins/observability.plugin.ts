import fp from 'fastify-plugin';
import { FastifyPluginAsync } from 'fastify';

const plugin: FastifyPluginAsync = async (app) => {
    console.log('OBSERVABILITY PLUGIN REGISTERED');

    app.addHook('onRequest', async (request, reply) => {
        const requestId = request.headers['x-request-id']?.toString() ?? request.id;

        reply.header('x-request-id', requestId);

        request.startTime = process.hrtime.bigint();

        request.log.info(
            {
                requestId,
                method: request.method,
                url: request.url,
            },
            'request started',
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
