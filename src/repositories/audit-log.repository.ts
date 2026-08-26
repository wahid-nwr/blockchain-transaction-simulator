import { Prisma } from '@prisma/client';
import { prisma } from '../database/prisma.js';

export interface AuditLogEntry {
    tenantId?: string | null;
    userId?: string | null;
    action: string;
    resource: string;
    resourceId?: string | null;
    metadata?: Prisma.InputJsonValue;
}

export class AuditLogRepository {
    async create(entry: AuditLogEntry) {
        return prisma.auditLog.create({
            data: {
                tenantId: entry.tenantId ?? null,
                userId: entry.userId ?? null,
                action: entry.action,
                resource: entry.resource,
                resourceId: entry.resourceId ?? null,
                metadata: entry.metadata,
            },
        });
    }

    async listByTenant(tenantId: string, page = 1, limit = 50) {
        return prisma.auditLog.findMany({
            where: { tenantId },
            orderBy: { createdAt: 'desc' },
            skip: (page - 1) * limit,
            take: limit,
        });
    }
}
