import { describe, it, expect, vi } from 'vitest';
import { LedgerService } from '../../src/services/ledger.service.js';
import * as metrics from '../../src/observability/metrics.js';
import { transactionsCreatedTotal } from '../../src/observability/transaction.metrics.js';

describe('LedgerService', () => {
    function createRepositoryMock() {
        return {
            create: vi.fn(),
            markSubmitted: vi.fn(),
            confirm: vi.fn(),
            markFailed: vi.fn(),
        };
    }

    it('should create pending transaction', async () => {
        const repository = createRepositoryMock();
        repository.create.mockResolvedValue({
            id: 'tx-1',
            status: 'PENDING',
        });

        const service = new LedgerService(repository as any);

        const result = await service.createPending({
            tenantId: 'tenant-1',
            tokenId: 'token-1',
            fromWalletId: 'wallet-1',
            toWalletId: 'wallet-2',
            amount: 100n,
        });

        expect(repository.create).toHaveBeenCalledWith({
            tenantId: 'tenant-1',
            tokenId: 'token-1',
            fromWalletId: 'wallet-1',
            toWalletId: 'wallet-2',
            amount: 100n,
            status: 'PENDING',
        });

        expect(result.status).toBe('PENDING');
    });

    it('should increment transaction created metric when creating pending transaction', async () => {
        const repository = createRepositoryMock();
        repository.create.mockResolvedValue({
            id: 'tx-1',
            status: 'PENDING',
        });

        const service = new LedgerService(repository as any);

        const incrementSpy = vi.spyOn(metrics, 'incrementMetric');

        const transaction = await service.createPending({
            tenantId: 'tenant-1',
            tokenId: 'token-1',
            fromWalletId: 'wallet-1',
            toWalletId: 'wallet-2',
            amount: 100n,
        });

        expect(incrementSpy).toHaveBeenCalledWith(transactionsCreatedTotal, {
            tenantId: transaction.tenantId,
            tokenId: transaction.tokenId,
        });
    });

    it('should attach blockchain hash', async () => {
        const repository = createRepositoryMock();

        await new LedgerService(repository as any).markSubmitted('tx-1', '0xabc');

        expect(repository.markSubmitted).toHaveBeenCalledWith('tx-1', '0xabc');
    });

    it('should confirm transaction converting block number', async () => {
        const repository = createRepositoryMock();

        await new LedgerService(repository as any).confirm('0xhash', {
            blockNumber: 100n,
            gasUsed: 50000n,
        });

        expect(repository.confirm).toHaveBeenCalledWith('0xhash', {
            blockNumber: 100,
            gasUsed: 50000n,
        });
    });

    it('should mark transaction failed', async () => {
        const repository = createRepositoryMock();

        await new LedgerService(repository as any).markFailed('tx-1', 'ERC20InsufficientBalance');

        expect(repository.markFailed).toHaveBeenCalledWith('tx-1', 'ERC20InsufficientBalance');
    });
});
