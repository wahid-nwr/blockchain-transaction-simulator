import { prisma } from '../../src/database/prisma.js';

export async function createTenant(overrides = {}) {
    return prisma.tenant.create({
        data: {
            name: 'Test Tenant',
            apiKey: `test-key-${Date.now()}`,
            ...overrides,
        },
    });
}
