import { FastifyInstance } from 'fastify';
import { Role } from '@prisma/client';
import { authenticate } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';
import { ApiKeyService } from '../../auth/api-key.service.js';
import { ApiKeyRepository } from '../../repositories/api-key.repository.js';
import { createApiKeySchema, apiKeyParamsSchema } from '../../validators/api-key.validator.js';
import { successResponse } from '../utils/response.js';

const apiKeyService = new ApiKeyService(new ApiKeyRepository());

/**
 * Mounted at `${API_PREFIX}/tenants/me/api-keys`. Scoped to the caller's own
 * tenant (from the JWT), not an arbitrary tenant id in the URL, so one
 * tenant's admin can never enumerate or revoke another tenant's keys.
 */
export default async function apiKeyRoutes(app: FastifyInstance) {
    app.post(
        '/',
        {
            schema: {
                body: createApiKeySchema,
            },
            preHandler: [authenticate, authorize([Role.ADMIN])],
        },
        async (request, reply) => {
            const body = createApiKeySchema.parse(request.body);

            const result = await apiKeyService.createKey(request.user.tenantId, body);

            // The raw key is only ever returned here, at creation time.
            return successResponse(reply, result, 201);
        },
    );

    app.get(
        '/',
        {
            preHandler: [authenticate, authorize([Role.ADMIN])],
        },
        async (request, reply) => {
            const keys = await apiKeyService.listKeys(request.user.tenantId);

            return successResponse(reply, keys);
        },
    );

    app.delete(
        '/:id',
        {
            preHandler: [authenticate, authorize([Role.ADMIN])],
        },
        async (request, reply) => {
            const { id } = apiKeyParamsSchema.parse(request.params);

            const result = await apiKeyService.revokeKey(request.user.tenantId, id);

            return successResponse(reply, result);
        },
    );
}
