import { buildApp } from './app.js';
import { env } from '../config/env.js';

const start = async () => {
    const app = await buildApp();

    try {
        await app.listen({
            port: env.PORT,
            host: '0.0.0.0',
        });

        console.log('API running on port 3000');

        const shutdown = async () => {
            app.log.info('Shutting down API server');
            await app.close();
            process.exit(0);
        };

        process.on('SIGTERM', shutdown);
        process.on('SIGINT', shutdown);
    } catch (error) {
        app.log.error(error);
        process.exit(1);
    }
};

start();
