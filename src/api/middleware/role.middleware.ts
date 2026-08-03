import { FastifyReply, FastifyRequest } from 'fastify';
import { Role } from '@prisma/client';

export function authorize(allowedRoles: Role[]) {
    return async (request: FastifyRequest, reply: FastifyReply) => {
        if (!request.user) {
            return reply.status(401).send({
                error: 'Unauthorized',
                requestId: request.id,
            });
        }
        const hasRole = allowedRoles.includes(request.user.role);
        if (!hasRole) {
            return reply.status(403).send({
                error: 'Forbidden',
                requestId: request.id,
            });
        }
    };
}
