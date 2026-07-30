import { FastifyReply, FastifyRequest } from 'fastify';
import { Role } from '@prisma/client';
import { verifyToken } from '../../auth/jwt.service.js';
import { updateContext } from '../../observability/context.js';

export async function authenticate(request: FastifyRequest, reply: FastifyReply) {
    const authorization = request.headers.authorization;

    if (!authorization) {
        return reply.status(401).send({
            error: 'Missing Authorization header',
            requestId: request.id,
        });
    }

    const [scheme, token] = authorization.split(' ');

    if (scheme !== 'Bearer' || !token) {
        return reply.status(401).send({
            error: 'Invalid Authorization header',
            requestId: request.id,
        });
    }

    try {
        const payload = verifyToken(request.server, token);

        request.user = {
            id: payload.id,
            email: payload.email,
            role: payload.role as Role,
            tenantId: payload.tenantId,
        };

        updateContext({
            tenantId: payload.tenantId,
            userId: payload.id,
        });
    } catch {
        return reply.status(401).send({
            error: 'Invalid or expired token',
            requestId: request.id,
        });
    }
}
