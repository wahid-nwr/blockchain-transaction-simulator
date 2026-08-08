import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TenantService } from '../../src/services/tenant.service.js';
import { TenantRepository } from '../../src/repositories/tenant.repository.js';

vi.mock('../../src/repositories/tenant.repository.js', () => {
    return {
        TenantRepository: vi.fn(),
    };
});

describe('TenantService', () => {
    let service: TenantService;

    const createMock = vi.fn();
    const findByApiKeyMock = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();

        vi.mocked(TenantRepository).mockImplementation(
            () =>
                ({
                    create: createMock,
                    findByApiKey: findByApiKeyMock,
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

    it('should find tenant by api key', async () => {
        findByApiKeyMock.mockResolvedValue({
            id: 'tenant-1',
            name: 'Test Tenant',
        });

        const result = await service.findByApiKey('tenant_test');

        expect(findByApiKeyMock).toHaveBeenCalledWith(
            'tenant_test',
        );

        expect(result.id).toBe('tenant-1');

        expect(result.name).toBe('Test Tenant');
    });

    it('should reject invalid tenant api key', async () => {
        findByApiKeyMock.mockResolvedValue(null);

        await expect(
            service.findByApiKey('invalid-key'),
        ).rejects.toThrow(
            'Invalid tenant API key',
        );
    });

    it('should reject revoked api key', async()=>{
        findByApiKeyMock.mockResolvedValue(null);

        await expect(
            service.findByApiKey('revoked-key')
        ).rejects.toThrow(
            'Invalid tenant API key'
        );
    });
});