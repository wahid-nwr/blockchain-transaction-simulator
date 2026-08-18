import { Role } from '@prisma/client';

import { ObservabilityContext } from '../observability/context';

declare module 'fastify' {
    interface FastifyRequest {
        user: {
            id: string;
            email: string;
            role: Role;
            tenantId: string;
        };

        requestContext?: ObservabilityContext;

        startTime?: bigint;
    }
}

declare module '@fastify/jwt' {
    interface FastifyJWT {
        payload: {
            id: string;
            email: string;
            role: Role;
            tenantId: string;
            jti?: string;
        };

        user: {
            id: string;
            email: string;
            role: Role;
            tenantId: string;
        };
    }
}
