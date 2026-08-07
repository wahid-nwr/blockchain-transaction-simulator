import { prisma } from '../../src/database/prisma.js';
import { hashToken } from '../../src/utils/crypto.hash.js';

export async function createTenant(overrides = {}) {
    const rawApiKey = `test-key-${Date.now()}`;

    const tenant = await prisma.tenant.create({
        data: {
            name: 'test',

            ...overrides,

            apiKeys: {
                create: {
                    keyHash: hashToken(rawApiKey),
                    keyPrefix: rawApiKey.substring(0, 8),
                    name: 'test-key',
                    scopes: ['*'],
                },
            },
        },
        include: {
            apiKeys: true,
        },
    });

    return {
        tenant: tenant,
        apiKey: rawApiKey,
    };
}
