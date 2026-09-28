import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BalanceSyncService } from '../../src/services/balance-sync.service.js';
import type { BalanceRepository } from '../../src/repositories/balance.repository.js';
import type { TokenBalanceReader } from '../../src/blockchain/token-balance-reader.js';

describe('BalanceSyncService', () => {
    let service: BalanceSyncService;

    const repositoryMock = {
        upsert: vi.fn(),
    };

    const balanceReaderMock: TokenBalanceReader = {
        getTokenBalance: vi.fn(),
    };

    beforeEach(() => {
        vi.clearAllMocks();

        service = new BalanceSyncService(
            repositoryMock as unknown as BalanceRepository,
            balanceReaderMock,
        );
    });

    it('should read blockchain balance and persist snapshot', async () => {
        balanceReaderMock.getTokenBalance = vi.fn().mockResolvedValue({
            balance: 12345n,
            blockNumber: 100n,
        });

        repositoryMock.upsert.mockResolvedValue({
            walletId: 'wallet-1',
            tokenId: 'token-1',
            balance: 12345n,
            blockNumber: 100n,
        });

        const result = await service.sync('wallet-1', '0xwallet', 'token-1', '0xtoken', 100n);

        expect(balanceReaderMock.getTokenBalance).toHaveBeenCalledWith({
            walletAddress: '0xwallet',
            assetIdentifier: '0xtoken',
            blockNumber: 100n,
        });

        expect(repositoryMock.upsert).toHaveBeenCalledWith({
            walletId: 'wallet-1',
            tokenId: 'token-1',
            balance: 12345n,
            blockNumber: 100n,
        });

        expect(result).toEqual({
            walletId: 'wallet-1',
            tokenId: 'token-1',
            balance: 12345n,
            blockNumber: 100n,
        });
    });

    it('should propagate blockchain read failure', async () => {
        const error = new Error('RPC unavailable');

        balanceReaderMock.getTokenBalance = vi.fn().mockRejectedValue(error);

        await expect(
            service.sync('wallet-1', '0xwallet', 'token-1', '0xtoken', 100n),
        ).rejects.toThrow('RPC unavailable');

        expect(repositoryMock.upsert).not.toHaveBeenCalled();
    });
});
