import { FastifyInstance } from 'fastify';
import { register } from '../../metrics/registry.js';

export default async function metricsRoute(app: FastifyInstance) {
    app.get('/', async (_, reply) => {
        reply.header('Content-Type', register.contentType).send(await register.metrics());
    });
}
