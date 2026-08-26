import Fastify from 'fastify';
import swagger from '@fastify/swagger';
import swaggerUI from '@fastify/swagger-ui';
import healthRoutes from './routes/health.routes.js';
import { API_PREFIX } from '../config/constants.js';
import jwt from '@fastify/jwt';
import { env } from '../config/env.js';
import authRoutes from './routes/auth.routes.js';
import walletRoutes from './routes/wallet.routes.js';
import tokenRoutes from './routes/token.routes.js';
import tenantRoutes from './routes/tenant.routes.js';
import transactionRoutes from './routes/transaction.routes.js';
import metricsRoute from './routes/metrics.route.js';
import apiKeyRoutes from './routes/api-key.routes.js';
import auditLogRoutes from './routes/audit-log.routes.js';
import { registerErrorHandler } from './error-handler.js';

import '../observability/index.js';
import '../metrics/index.js';

import { observabilityPlugin } from './plugins/observability.plugin.js';
import { initializeDeploymentMetrics } from '../observability/bootstrap.js';

import {
    jsonSchemaTransform,
    validatorCompiler,
    serializerCompiler,
} from 'fastify-type-provider-zod';

export async function buildApp() {
    const app = Fastify({
        logger: {
            level: 'info',
        },
    });

    initializeDeploymentMetrics();

    await app.register(observabilityPlugin);

    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);

    await app.register(swagger, {
        openapi: {
            info: {
                title: 'Blockchain Transaction Simulator API',
                description: 'Stablecoin and blockchain transaction platform',
                version: '1.0.0',
            },
            servers: [
                {
                    url: `http://localhost:${env.PORT}`,
                },
            ],
        },
        transform: jsonSchemaTransform,
    });

    registerErrorHandler(app);

    await app.register(jwt, {
        secret: env.JWT_SECRET,
        sign: {
            expiresIn: env.JWT_ACCESS_EXPIRES,
        },
    });

    await app.register(healthRoutes, {
        prefix: API_PREFIX,
    });

    await app.register(tenantRoutes, {
        prefix: `${API_PREFIX}/tenants`,
    });

    await app.register(apiKeyRoutes, {
        prefix: `${API_PREFIX}/tenants/me/api-keys`,
    });

    await app.register(auditLogRoutes, {
        prefix: `${API_PREFIX}/audit-logs`,
    });

    await app.register(walletRoutes, {
        prefix: `${API_PREFIX}/wallets`,
    });

    await app.register(tokenRoutes, {
        prefix: `${API_PREFIX}/tokens`,
    });

    await app.register(transactionRoutes, {
        prefix: `${API_PREFIX}/transactions`,
    });

    await app.register(authRoutes, {
        prefix: `${API_PREFIX}/auth`,
    });

    await app.register(metricsRoute, {
        prefix: `${API_PREFIX}/metrics`,
    });

    await app.register(swaggerUI, {
        routePrefix: '/docs',
    });

    return app;
}
