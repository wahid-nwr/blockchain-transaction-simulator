import { Role } from '@prisma/client';

declare module 'fastify' {
    interface FastifyRequest {
        user: {
            id: string;
            email: string;
            role: Role;
            tenantId: string;
        };
    }
}

declare module '@fastify/jwt' {
    interface FastifyJWT {
        payload: {
            id: string;
            email: string;
            role: Role;
            tenantId: string;
        };

        user: {
            id: string;
            email: string;
            role: Role;
            tenantId: string;
        };
    }
}
