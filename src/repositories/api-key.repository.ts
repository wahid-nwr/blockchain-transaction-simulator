import { prisma } from '../database/prisma.js';

export class ApiKeyRepository {
    async create(data: {
        tenantId: string;
        keyHash: string;
        keyPrefix: string;
        name: string;
        scopes: string[];
        expiresAt?: Date | null;
    }) {
        return prisma.apiKey.create({
            data: {
                tenantId: data.tenantId,
                keyHash: data.keyHash,
                keyPrefix: data.keyPrefix,
                name: data.name,
                scopes: data.scopes,
                expiresAt: data.expiresAt ?? null,
            },
        });
    }

    /**
     * Candidate lookup by prefix only. The caller does not know the tenant
     * before the raw key is verified, so this cannot be tenant-scoped. The
     * prefix narrows to a small candidate set (indexed); the caller is
     * still responsible for the constant-time hash comparison against each
     * candidate so key verification isn't a timing oracle on `keyHash`.
     */
    async findActiveByPrefix(keyPrefix: string) {
        return prisma.apiKey.findMany({
            where: {
                keyPrefix,
                active: true,
                revokedAt: null,
                OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
            },
            include: {
                tenant: true,
            },
        });
    }

    async touchLastUsed(id: string) {
        return prisma.apiKey.update({
            where: { id },
            data: { lastUsedAt: new Date() },
        });
    }

    async listByTenant(tenantId: string) {
        return prisma.apiKey.findMany({
            where: { tenantId },
            orderBy: { createdAt: 'desc' },
        });
    }

    async findByIdForTenant(tenantId: string, id: string) {
        return prisma.apiKey.findFirst({
            where: { id, tenantId },
        });
    }

    async revoke(tenantId: string, id: string) {
        const result = await prisma.apiKey.updateMany({
            where: { id, tenantId, revokedAt: null },
            data: { active: false, revokedAt: new Date() },
        });

        return result.count === 1;
    }
}
