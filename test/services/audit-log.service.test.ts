import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuditLogService } from '../../src/services/audit-log.service.js';

vi.mock('../../src/observability/logger.js', () => ({
    getLogger: () => ({
        error: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
    }),
}));

describe('AuditLogService', () => {
    const repository = {
        create: vi.fn(),
        listByTenant: vi.fn(),
    } as any;

    let service: AuditLogService;

    beforeEach(() => {
        vi.clearAllMocks();
        service = new AuditLogService(repository);
    });

    it('writes the entry as given', async () => {
        repository.create.mockResolvedValue({ id: 'log-1' });

        await service.record({
            tenantId: 'tenant-1',
            userId: 'user-1',
            action: 'transaction.created',
            resource: 'Transaction',
            resourceId: 'tx-1',
            metadata: { amount: '100' },
        });

        expect(repository.create).toHaveBeenCalledWith(
            expect.objectContaining({
                tenantId: 'tenant-1',
                action: 'transaction.created',
                resourceId: 'tx-1',
            }),
        );
    });

    it('never throws when the repository write fails', async () => {
        repository.create.mockRejectedValue(new Error('connection lost'));

        await expect(service.record({ action: 'x', resource: 'Y' })).resolves.toBeUndefined();
    });

    it('delegates listForTenant to the repository with pagination', async () => {
        repository.listByTenant.mockResolvedValue([{ id: 'log-1' }]);

        const result = await service.listForTenant('tenant-1', 2, 10);

        expect(repository.listByTenant).toHaveBeenCalledWith('tenant-1', 2, 10);
        expect(result).toEqual([{ id: 'log-1' }]);
    });
});
