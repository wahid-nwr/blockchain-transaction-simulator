import { FastifyInstance } from 'fastify';
import { AuthService } from '../../services/auth.service.js';
import { TenantService } from '../../services/tenant.service.js';
import { UserRepository } from '../../repositories/user.repository.js';
import { RefreshTokenRepository } from '../../repositories/refresh-token.repository.js';
import {
    registerSchema,
    userResponseSchema,
    loginSchema,
    loginResponseSchema,
    refreshSchema,
    refreshResponseSchema,
} from '../../validators/auth.validator.js';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { successResponse } from '../utils/response.js';
import { Errors } from '../../common/errors/errors.js';

export default async function authRoutes(app: FastifyInstance) {
    const authService = new AuthService(new UserRepository(), new RefreshTokenRepository());
    const tenantService = new TenantService();
    const api = app.withTypeProvider<ZodTypeProvider>();
    api.post(
        '/register',
        {
            schema: {
                body: registerSchema,
                response: { 201: userResponseSchema },
            },
        },
        async (request, reply) => {
            const tenantKey = request.headers['x-tenant-key'];

            if (!tenantKey || typeof tenantKey !== 'string') {
                throw Errors.unauthorized('Tenant API key required');
            }
            const tenant = await tenantService.findByApiKey(tenantKey);

            const user = await authService.register(
                request.body.email,
                request.body.password,
                tenant.id,
            );

            return successResponse(
                reply,
                {
                    id: user.id,
                    email: user.email,
                    role: user.role,
                    tenantId: user.tenantId,
                    createdAt: user.createdAt.toISOString(),
                },
                201,
            );
        },
    );
    api.post(
        '/login',
        {
            schema: {
                tags: ['Auth'],
                body: loginSchema,
                response: {
                    200: loginResponseSchema,
                },
            },
        },
        async (request, reply) => {
            const { email, password } = request.body;

            const result = await authService.login(app, email, password);

            return reply.send({
                data: result,
                requestId: request.id,
            });
        },
    );

    api.post(
        '/refresh',
        {
            schema: {
                tags: ['Auth'],
                body: refreshSchema,
                response: {
                    200: refreshResponseSchema,
                },
            },
        },
        async (request, reply) => {
            const { refreshToken } = request.body;

            const result = await authService.refresh(app, refreshToken);

            return reply.send({
                data: result,
                requestId: request.id,
            });
        },
    );
}
