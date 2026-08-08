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

    async findByApiKey(apiKey: string) {
        const keyHash = hashToken(apiKey);

        const record = await prisma.apiKey.findFirst({
            where: {
                keyHash,
                active: true,
                revokedAt: null,
                OR: [
                    {
                        expiresAt: null,
                    },
                    {
                        expiresAt: {
                            gt: new Date(),
                        },
                    },
                ],
            },
            include: {
                tenant: true,
            },
        });

        if (!record) {
            return null;
        }

        await prisma.apiKey.update({
            where: {
                id: record.id,
            },
            data: {
                lastUsedAt: new Date(),
            },
        });

        return record.tenant;
    }

    findById(id: string) {
        return prisma.tenant.findUnique({
            where: {
                id,
            },
        });
    }
}
