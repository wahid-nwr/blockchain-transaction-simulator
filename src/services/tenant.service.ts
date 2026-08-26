import crypto from 'node:crypto';
import { TenantRepository } from '../repositories/tenant.repository.js';
import { auditLogService } from './audit-log.service.js';

export class TenantService {
private readonly repository: TenantRepository;

constructor() {
        this.repository = new TenantRepository();
    }

    async createTenant(name: string) {
        const apiKey = `tenant_${crypto.randomBytes(32).toString('hex')}`;
        const result = await this.repository.create({
            name,
            apiKey,
        });

        await auditLogService.record({
            tenantId: result.tenant.id,
            action: 'tenant.created',
            resource: 'Tenant',
            resourceId: result.tenant.id,
            metadata: { name },
        });

        return result;
    }
}