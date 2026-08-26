import { prisma } from '../database/prisma.js';
import { hashToken } from '../utils/crypto.hash.js';

export class TenantRepository {
async create(data: { name: string; apiKey: string }) {
        const keyHash = hashToken(data.apiKey);
        const tenant = await prisma.tenant.create({
            data: {
                name: data.name,

                apiKeys: {
                    create: {
                        keyHash,
                        keyPrefix: data.apiKey.substring(0, 8),
                        name: 'default',
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
            apiKey: data.apiKey,
        };
    }

    findById(id: string) {
        return prisma.tenant.findUnique({
            where: {
                id,
            },
        });
    }
}