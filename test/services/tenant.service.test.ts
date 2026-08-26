import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TenantService } from '../../src/services/tenant.service.js';
import { TenantRepository } from '../../src/repositories/tenant.repository.js';
import { auditLogService } from '../../src/services/audit-log.service.js';

vi.mock('../../src/repositories/tenant.repository.js', () => {
    return {
        TenantRepository: vi.fn(),
    };
});

vi.mock('../../src/services/audit-log.service.js', () => ({
    auditLogService: {
        record: vi.fn(),
    },
}));

describe('TenantService', () => {
    let service: TenantService;

    const createMock = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();

        vi.mocked(TenantRepository).mockImplementation(
            () =>
                ({
                    create: createMock,
                }) as any,
        );

        service = new TenantService();
    });

    it('should create tenant with generated api key', async () => {
        createMock.mockResolvedValue({
            tenant: {
                id: 'tenant-1',
                name: 'Test Tenant',
            },
            apiKey: 'tenant_xxxxx',
        });

        const result = await service.createTenant('Test Tenant');

        expect(createMock).toHaveBeenCalledTimes(1);

        const argument = createMock.mock.calls[0][0];

        expect(argument.name).toBe('Test Tenant');

        expect(argument.apiKey).toMatch(/^tenant_[a-f0-9]{64}$/);

        expect(result.tenant.id).toBe('tenant-1');
        expect(result.apiKey).toBeDefined();
    });

    it('should audit-log tenant creation', async () => {
        createMock.mockResolvedValue({
            tenant: { id: 'tenant-1', name: 'Test Tenant' },
            apiKey: 'tenant_xxxxx',
        });

        await service.createTenant('Test Tenant');

        expect(auditLogService.record).toHaveBeenCalledWith(
            expect.objectContaining({
                action: 'tenant.created',
                tenantId: 'tenant-1',
            }),
        );
    });
});
