import { FastifyInstance } from 'fastify';

export default async function healthRoutes(app: FastifyInstance) {
    app.get('/health', async () => {
        return {
            status: 'ok',
            service: 'blockchain-transaction-api',
            timestamp: new Date().toISOString(),
        };
    });

    app.get('/ready', async () => {
        return {
            status: 'ready',
        };
    });
}
