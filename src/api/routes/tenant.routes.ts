import { FastifyInstance } from 'fastify';
import { createTenantSchema } from '../../validators/tenant.validator.js';
import { successResponse } from '../utils/response.js';
import { TenantService } from '../../services/tenant.service.js';

const tenantService = new TenantService();

export default async function tenantRoutes(app: FastifyInstance) {
    app.post(
        '/',
        {
            schema: {
                body: createTenantSchema,
            },
        },
        async (request, reply) => {
            const body = createTenantSchema.parse(request.body);

            const result = await tenantService.createTenant(body.name);
            return successResponse(reply, result, 201);
        },
    );
}
