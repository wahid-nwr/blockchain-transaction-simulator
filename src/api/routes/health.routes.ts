import { FastifyInstance } from 'fastify';
import { checkReadiness } from '../health/readiness.service.js';

export default async function healthRoutes(app: FastifyInstance) {
    app.get('/health', async () => {
        return {
            status: 'ok',
            service: 'blockchain-transaction-api',
            version: process.env.APP_VERSION ?? 'unknown',
            commit: process.env.GIT_SHA ?? 'unknown',
            deploymentId: process.env.DEPLOYMENT_ID ?? 'unknown',
            deploymentCreatedAt: process.env.DEPLOYMENT_CREATED_AT ?? 'unknown',
            timestamp: new Date().toISOString(),
        };
    });

    app.get('/ready', async (_, reply) => {
        const readiness = await checkReadiness();

        if (!readiness.healthy) {
            return reply.code(503).send(readiness);
        }

        return readiness;
    });
}
