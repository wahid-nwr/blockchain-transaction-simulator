import { Prisma } from '@prisma/client';
import { AuditLogRepository } from '../repositories/audit-log.repository.js';
import { getLogger } from '../observability/logger.js';

export interface RecordAuditEntry {
    tenantId?: string | null;
    userId?: string | null;
    action: string;
    resource: string;
    resourceId?: string | null;
    metadata?: Prisma.InputJsonValue;
}

export class AuditLogService {
    constructor(private readonly repository: AuditLogRepository) {}

    /**
     * Best-effort by design: a failure to write the audit trail must never
     * fail (or roll back) the operation being audited. We log loudly on
     * failure instead, since a silent gap in the trail is the one outcome
     * worse than a logged one.
     */
    async record(entry: RecordAuditEntry): Promise<void> {
        try {
            await this.repository.create(entry);
        } catch (error) {
            getLogger().error(
                {
                    action: entry.action,
                    resource: entry.resource,
                    resourceId: entry.resourceId,
                    tenantId: entry.tenantId,
                    error: error instanceof Error ? error.message : String(error),
                },
                'audit_log.write.failed',
            );
        }
    }

    async listForTenant(tenantId: string, page = 1, limit = 50) {
        return this.repository.listByTenant(tenantId, page, limit);
    }
}

// A shared instance is exported for the common case (services calling
// `auditLogService.record(...)` inline). Routes/tests that need to inject a
// mock repository can still construct `new AuditLogService(repo)` directly.
export const auditLogService = new AuditLogService(new AuditLogRepository());
