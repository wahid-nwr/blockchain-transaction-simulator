import { FastifyInstance } from 'fastify';
import { registry } from '../../observability/metrics.js';

export default async function metricsRoute(app: FastifyInstance) {
    app.get('/', async (_, reply) => {
        reply.header('Content-Type', registry.contentType).send(await registry.metrics());
    });
}
