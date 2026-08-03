import swaggerUI from '@fastify/swagger-ui';
import { FastifyInstance } from 'fastify';

export default async function swaggerUIPlugin(app: FastifyInstance) {
    await app.register(swaggerUI, {
        routePrefix: '/docs',
    });
}
