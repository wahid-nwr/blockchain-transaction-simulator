import { prisma } from '../../src/database/prisma.js';
import { createTenant } from './tenant.factory.js';

export async function createUser(overrides: any = {}) {
    const tenant = overrides.tenant ?? (await createTenant());

    const { tenant: _tenant, ...userOverrides } = overrides;

    return prisma.user.create({
        data: {
            email: `user-${Date.now()}@test.com`,
            passwordHash: 'hash',
            ...userOverrides,

            tenant: {
                connect: {
                    id: tenant.id,
                },
            },
        },
    });
}
