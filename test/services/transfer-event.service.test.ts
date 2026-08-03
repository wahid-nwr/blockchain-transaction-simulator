import { describe, it, expect, vi, beforeEach } from 'vitest';

import { TransferEventService } from '../../src/services/transfer-event.service.js';
import { TokenRepository } from '../../src/repositories/token.repository.js';
import { TransferRepository } from '../../src/repositories/transfer.repository.js';
import { WalletRepository } from '../../src/repositories/wallet.repository.js';
import { BalanceSyncService } from '../../src/services/balance-sync.service.js';

describe('TransferEventService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should process transfer event and sync balances', async () => {
        vi.spyOn(TokenRepository.prototype, 'findByContractAddress').mockResolvedValue({
            id: 'token-1',
            contractAddress: '0xtoken',
        } as any);

        vi.spyOn(TransferRepository.prototype, 'create').mockResolvedValue({
            id: 'transfer-1',
        } as any);

        vi.spyOn(WalletRepository.prototype, 'findByAddress').mockResolvedValue({
            id: 'wallet-1',
            address: '0xwallet',
        } as any);

        const syncMock = vi.spyOn(BalanceSyncService.prototype, 'sync').mockResolvedValue({
            id: 'balance-1',
            walletId: 'wallet-1',
            tokenId: 'token-1',
            balance: 1000n,
            blockNumber: 10n,
            updatedAt: new Date(),
        });

        const service = new TransferEventService();

        await service.handleTransferEvent({
            tokenAddress: '0xtoken',
            from: '0xwallet',
            to: '0xreceiver',
            amount: 1000n,
            transactionHash: '0xtxhash',
            logIndex: 101,
            blockNumber: 10n,
        });

        expect(TransferRepository.prototype.create).toHaveBeenCalledWith({
            tokenId: 'token-1',
            from: '0xwallet',
            to: '0xreceiver',
            amount: 1000n,
            transactionHash: '0xtxhash',
            logIndex: 101,
            blockNumber: 10n,
        });

        expect(syncMock).toHaveBeenCalledTimes(2);
    });

    it('should reject event for unknown token', async () => {
        vi.spyOn(TokenRepository.prototype, 'findByContractAddress').mockResolvedValue(null);

        const service = new TransferEventService();

        await expect(
            service.handleTransferEvent({
                tokenAddress: '0xunknown',
                from: '0xfrom',
                to: '0xto',
                amount: 100n,
                transactionHash: '0xhash',
                logIndex: 101,
                blockNumber: 1n,
            }),
        ).rejects.toThrow('Token not registered');
    });

    it('should skip balance sync for unknown wallets', async () => {
        vi.spyOn(TokenRepository.prototype, 'findByContractAddress').mockResolvedValue({
            id: 'token-1',
            contractAddress: '0xtoken',
        } as any);

        vi.spyOn(TransferRepository.prototype, 'create').mockResolvedValue({} as any);

        vi.spyOn(WalletRepository.prototype, 'findByAddress').mockResolvedValue(null);

        const syncMock = vi.spyOn(BalanceSyncService.prototype, 'sync');

        const service = new TransferEventService();

        await service.handleTransferEvent({
            tokenAddress: '0xtoken',
            from: '0xmissing1',
            to: '0xmissing2',
            amount: 500n,
            transactionHash: '0xtx',
            logIndex: 101,
            blockNumber: 5n,
        });

        expect(syncMock).not.toHaveBeenCalled();
    });
});
