import { prisma } from '../../src/database/prisma.js';
import { createTenant } from './tenant.factory.js';

export async function createUser(
    overrides: {
        tenant?: {
            id: string;
        };
        email?: string;
        passwordHash?: string;
    } = {},
) {
    const tenant = overrides.tenant ?? (await createTenant()).tenant;

    return prisma.user.create({
        data: {
            email: overrides.email ?? `user-${Date.now()}@test.com`,
            passwordHash: overrides.passwordHash ?? 'hash',

            tenant: {
                connect: {
                    id: tenant.id,
                },
            },
        },
    });
}