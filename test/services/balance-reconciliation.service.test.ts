import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BalanceReconciliationService } from '../../src/services/balance-reconciliation.service.js';
import type { BalanceRepository } from '../../src/repositories/balance.repository.js';
import type { TokenBalanceReader } from '../../src/blockchain/token-balance-reader.js';

describe('BalanceReconciliationService', () => {
    let service: BalanceReconciliationService;

    const repositoryMock = {
        find: vi.fn(),
        upsert: vi.fn(),
    };

    const balanceReaderMock: TokenBalanceReader = {
        getTokenBalance: vi.fn(),
    };

    beforeEach(() => {
        vi.clearAllMocks();

        service = new BalanceReconciliationService(
            repositoryMock as unknown as BalanceRepository,
            balanceReaderMock,
        );
    });

    it('should return MATCH when persisted and chain balances agree', async () => {
        repositoryMock.find.mockResolvedValue({
            walletId: 'wallet-1',
            tokenId: 'token-1',
            balance: 1000n,
            blockNumber: 100n,
        });

        balanceReaderMock.getTokenBalance = vi.fn().mockResolvedValue({
            balance: 1000n,
            blockNumber: 100n,
        });

        const result = await service.reconcile('wallet-1', '0xwallet', 'token-1', '0xtoken', 100n);

        expect(result).toEqual({
            status: 'MATCH',
            walletId: 'wallet-1',
            tokenId: 'token-1',
            persisted: {
                balance: 1000n,
                blockNumber: 100n,
            },
            chain: {
                balance: 1000n,
                blockNumber: 100n,
            },
        });
    });

    it('should return MISMATCH when balances differ at the same block', async () => {
        repositoryMock.find.mockResolvedValue({
            walletId: 'wallet-1',
            tokenId: 'token-1',
            balance: 1000n,
            blockNumber: 100n,
        });

        balanceReaderMock.getTokenBalance = vi.fn().mockResolvedValue({
            balance: 900n,
            blockNumber: 100n,
        });

        const result = await service.reconcile('wallet-1', '0xwallet', 'token-1', '0xtoken', 100n);

        expect(result.status).toBe('MISMATCH');
        expect(result.persisted).toEqual({
            balance: 1000n,
            blockNumber: 100n,
        });
        expect(result.chain).toEqual({
            balance: 900n,
            blockNumber: 100n,
        });
    });

    it('should return MISMATCH when a newer chain state differs', async () => {
        repositoryMock.find.mockResolvedValue({
            walletId: 'wallet-1',
            tokenId: 'token-1',
            balance: 1000n,
            blockNumber: 100n,
        });

        balanceReaderMock.getTokenBalance = vi.fn().mockResolvedValue({
            balance: 900n,
            blockNumber: 101n,
        });

        const result = await service.reconcile('wallet-1', '0xwallet', 'token-1', '0xtoken', 101n);

        expect(result.status).toBe('MISMATCH');
    });

    it('should return STALE_OBSERVATION when the chain observation is older', async () => {
        repositoryMock.find.mockResolvedValue({
            walletId: 'wallet-1',
            tokenId: 'token-1',
            balance: 1000n,
            blockNumber: 101n,
        });

        balanceReaderMock.getTokenBalance = vi.fn().mockResolvedValue({
            balance: 900n,
            blockNumber: 100n,
        });

        const result = await service.reconcile('wallet-1', '0xwallet', 'token-1', '0xtoken', 100n);

        expect(result.status).toBe('STALE_OBSERVATION');
    });

    it('should return MISMATCH when no persisted snapshot exists', async () => {
        repositoryMock.find.mockResolvedValue(null);

        balanceReaderMock.getTokenBalance = vi.fn().mockResolvedValue({
            balance: 1000n,
            blockNumber: 100n,
        });

        const result = await service.reconcile('wallet-1', '0xwallet', 'token-1', '0xtoken', 100n);

        expect(result).toEqual({
            status: 'MISMATCH',
            walletId: 'wallet-1',
            tokenId: 'token-1',
            persisted: null,
            chain: {
                balance: 1000n,
                blockNumber: 100n,
            },
        });
    });

    it('should not modify the persisted snapshot', async () => {
        repositoryMock.find.mockResolvedValue({
            walletId: 'wallet-1',
            tokenId: 'token-1',
            balance: 1000n,
            blockNumber: 100n,
        });

        balanceReaderMock.getTokenBalance = vi.fn().mockResolvedValue({
            balance: 900n,
            blockNumber: 101n,
        });

        await service.reconcile('wallet-1', '0xwallet', 'token-1', '0xtoken', 101n);

        expect(repositoryMock.upsert).not.toHaveBeenCalled();
    });

    it('should propagate a repository failure', async () => {
        repositoryMock.find.mockRejectedValue(new Error('Database unavailable'));

        await expect(
            service.reconcile('wallet-1', '0xwallet', 'token-1', '0xtoken', 100n),
        ).rejects.toThrow('Database unavailable');

        expect(balanceReaderMock.getTokenBalance).not.toHaveBeenCalled();
    });

    it('should propagate a blockchain read failure', async () => {
        repositoryMock.find.mockResolvedValue({
            walletId: 'wallet-1',
            tokenId: 'token-1',
            balance: 1000n,
            blockNumber: 100n,
        });

        balanceReaderMock.getTokenBalance = vi.fn().mockRejectedValue(new Error('RPC unavailable'));

        await expect(
            service.reconcile('wallet-1', '0xwallet', 'token-1', '0xtoken', 100n),
        ).rejects.toThrow('RPC unavailable');
    });
});
