import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TransferService } from '../../src/services/transfer.service.js';
import { LedgerService } from '../../src/services/ledger.service.js';
import { TokenRepository } from '../../src/repositories/token.repository.js';
import { WalletRepository } from '../../src/repositories/wallet.repository.js';

vi.mock('../../src/blockchain/client.js', () => ({
    walletClient: {
        writeContract: vi.fn(),
    },
}));

import { walletClient } from '../../src/blockchain/client.js';

describe('TransferService', () => {
    const ledgerMock = {
        createPending: vi.fn(),
        attachHash: vi.fn(),
        markFailed: vi.fn(),
    };

    const tokenRepositoryMock = {
        findById: vi.fn(),
    };

    const walletRepositoryMock = {
        findById: vi.fn(),
    };

    let service: TransferService;

    beforeEach(() => {
        vi.clearAllMocks();
        service = new TransferService(
            ledgerMock as unknown as LedgerService,
            tokenRepositoryMock as unknown as TokenRepository,
            walletRepositoryMock as unknown as WalletRepository,
        );
    });

    it('should create pending transaction and attach blockchain hash', async () => {
        tokenRepositoryMock.findById.mockResolvedValue({
            id: 'token-1',
            contractAddress: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
        });

        walletRepositoryMock.findById.mockImplementation(async (id: string) => {
            if (id === 'wallet-1') {
                return {
                    id: 'wallet-1',
                    address: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
                };
            }

            return {
                id: 'wallet-2',
                address: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
            };
        });

        ledgerMock.createPending.mockResolvedValue({
            id: 'tx-123',
        });

        (walletClient.writeContract as any).mockResolvedValue('0xtransactionhash');

        ledgerMock.attachHash.mockResolvedValue({
            id: 'tx-123',
            txHash: '0xtransactionhash',
        });

        const result = await service.transfer({
            tenantId: 'tenant-1',
            tokenId: 'token-1',
            fromWalletId: 'wallet-1',
            toWalletId: 'wallet-2',
            amount: 1000n,
            account: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
            to: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
        });

        expect(tokenRepositoryMock.findById).toHaveBeenCalledWith('token-1');

        expect(walletRepositoryMock.findById).toHaveBeenCalled();

        expect(ledgerMock.createPending).toHaveBeenCalled();

        expect(walletClient.writeContract).toHaveBeenCalled();

        expect(ledgerMock.attachHash).toHaveBeenCalledWith('tx-123', '0xtransactionhash');

        expect(result).toEqual({
            id: 'tx-123',
            txHash: '0xtransactionhash',
        });
    });

    it('should mark transaction failed when blockchain transfer fails', async () => {
        tokenRepositoryMock.findById.mockResolvedValue({
            id: 'token-1',
            contractAddress: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
        });

        walletRepositoryMock.findById.mockResolvedValue({
            id: 'wallet-2',
            address: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
        });

        ledgerMock.createPending.mockResolvedValue({
            id: 'tx-123',
        });

        const error = new Error('RPC failure');

        (walletClient.writeContract as any).mockRejectedValue(error);

        await expect(
            service.transfer({
                tenantId: 'tenant-1',
                tokenId: 'token-1',
                fromWalletId: 'wallet-1',
                toWalletId: 'wallet-2',
                amount: 1000n,
                account: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
                to: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
            }),
        ).rejects.toThrow('RPC failure');

        expect(ledgerMock.markFailed).toHaveBeenCalledWith('tx-123');
    });
});
