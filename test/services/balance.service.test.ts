import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BalanceService } from '../../src/services/balance.service.js';

describe('BalanceService', () => {
    let service: BalanceService;

    const repository = {
        find: vi.fn(),
        findByWallet: vi.fn(),
        upsert: vi.fn(),
    };

    beforeEach(() => {
        vi.clearAllMocks();

        service = new BalanceService(repository as any);
    });

    it('should get balance by wallet and token', async () => {
        repository.find.mockResolvedValue({
            walletId: 'wallet-1',
            tokenId: 'token-1',
            balance: 1000n,
            blockNumber: 10n,
        });

        const result = await service.getBalance('wallet-1', 'token-1');

        expect(repository.find).toHaveBeenCalledWith('wallet-1', 'token-1');

        expect(result.balance).toBe(1000n);
    });

    it('should return wallet balances', async () => {
        repository.findByWallet.mockResolvedValue([
            {
                walletId: 'wallet-1',
                tokenId: 'token-1',
                balance: 500n,
                blockNumber: 20n,
            },
        ]);

        const result = await service.getWalletBalances('wallet-1');

        expect(repository.findByWallet).toHaveBeenCalledWith('wallet-1');

        expect(result).toHaveLength(1);

        expect(result[0].balance).toBe(500n);
    });

    it('should update balance', async () => {
        repository.upsert.mockResolvedValue({
            walletId: 'wallet-1',
            tokenId: 'token-1',
            balance: 2000n,
            blockNumber: 100n,
        });

        const result = await service.updateBalance('wallet-1', 'token-1', 2000n, 100n);

        expect(repository.upsert).toHaveBeenCalledWith({
            walletId: 'wallet-1',
            tokenId: 'token-1',
            balance: 2000n,
            blockNumber: 100n,
        });

        expect(result.balance).toBe(2000n);
    });
});
