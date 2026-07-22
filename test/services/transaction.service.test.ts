import { describe, it, expect, vi, beforeEach } from 'vitest';

import { TransactionService } from '../../src/services/transaction.service.js';
import { TransactionRepository } from '../../src/repositories/transaction.repository.js';

describe('TransactionService', () => {
    const repositoryMock = {
        findById: vi.fn(),
        findAll: vi.fn(),
    };

    let service: TransactionService;

    beforeEach(() => {
        vi.clearAllMocks();
        service = new TransactionService(repositoryMock as unknown as TransactionRepository);
    });

    it('should get transaction by id', async () => {
        repositoryMock.findById.mockResolvedValue({
            id: 'tx-123',
            tenantId: 'tenant-123',
            status: 'CONFIRMED',
        });

        const result = await service.getById('tx-123', 'tenant-123');

        expect(repositoryMock.findById).toHaveBeenCalledWith('tx-123', 'tenant-123');

        expect(result).toEqual({
            id: 'tx-123',
            tenantId: 'tenant-123',
            status: 'CONFIRMED',
        });
    });

    it('should list transactions for tenant', async () => {
        repositoryMock.findAll.mockResolvedValue([
            {
                id: 'tx-1',
            },
            {
                id: 'tx-2',
            },
        ]);

        const result = await service.list('tenant-1', 2, 50);

        expect(repositoryMock.findAll).toHaveBeenCalledWith('tenant-1', 2, 50);

        expect(result).toEqual([
            {
                id: 'tx-1',
            },
            {
                id: 'tx-2',
            },
        ]);
    });

    it('should use default pagination values', async () => {
        repositoryMock.findAll.mockResolvedValue([]);

        await service.list('tenant-1');

        expect(repositoryMock.findAll).toHaveBeenCalledWith('tenant-1', 1, 20);
    });
});
