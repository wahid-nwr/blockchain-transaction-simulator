import { FastifyInstance } from 'fastify';
import { Role } from '@prisma/client';
import { authenticate } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';
import { auditLogService } from '../../services/audit-log.service.js';
import { successResponse } from '../utils/response.js';

export default async function auditLogRoutes(app: FastifyInstance) {
    app.get(
        '/',
        {
            preHandler: [authenticate, authorize([Role.ADMIN])],
        },
        async (request, reply) => {
            const query = request.query as { page?: string; limit?: string };

            const entries = await auditLogService.listForTenant(
                request.user.tenantId,
                Number(query.page ?? 1),
                Number(query.limit ?? 50),
            );

            return successResponse(reply, entries);
        },
    );
}
