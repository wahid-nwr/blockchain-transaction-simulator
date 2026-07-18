import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TransferService } from '../../src/services/transfer.service.js';
import { LedgerService } from '../../src/services/ledger.service.js';
import { WalletService } from '../../src/services/wallet.service.js';
import { TokenServive } from '../../src/services/token.service.js';

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

    const walletServiceMock = {
        getUserWallets: vi.fn(),
        getWalletById: vi.fn(),
    };

    const tokenServiceMock = {
        getToken: vi.fn(),
    };

    let service: TransferService;

    beforeEach(() => {
        vi.clearAllMocks();

        service = new TransferService(
            ledgerMock as unknown as LedgerService,
            walletServiceMock as unknown as WalletService,
            tokenServiceMock as unknown as TokenServive,
        );
    });

    it('should create pending transaction and attach blockchain hash', async () => {
        tokenServiceMock.getToken.mockResolvedValue({
            id: 'token-1',
            contractAddress: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
        });

        walletServiceMock.getUserWallets.mockResolvedValue([
            {
                id: 'wallet-1',
                address: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
            },
        ]);

        walletServiceMock.getWalletById.mockResolvedValue({
            id: 'wallet-2',
            address: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
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
            userId: 'user-1',
            tokenId: 'token-1',
            toWalletId: 'wallet-2',
            amount: 1000n,
        });

        expect(tokenServiceMock.getToken).toHaveBeenCalledWith('token-1');

        expect(walletServiceMock.getUserWallets).toHaveBeenCalledWith('user-1');

        expect(walletServiceMock.getWalletById).toHaveBeenCalledWith('wallet-2');

        expect(ledgerMock.createPending).toHaveBeenCalledWith({
            tenantId: 'tenant-1',
            tokenId: 'token-1',
            fromWalletId: 'wallet-1',
            toWalletId: 'wallet-2',
            amount: 1000n,
        });

        expect(walletClient.writeContract).toHaveBeenCalled();

        expect(ledgerMock.attachHash).toHaveBeenCalledWith('tx-123', '0xtransactionhash');

        expect(result).toEqual({
            id: 'tx-123',
            txHash: '0xtransactionhash',
        });
    });

    it('should mark transaction failed when blockchain transfer fails', async () => {
        tokenServiceMock.getToken.mockResolvedValue({
            id: 'token-1',
            contractAddress: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
        });

        walletServiceMock.getUserWallets.mockResolvedValue([
            {
                id: 'wallet-1',
                address: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
            },
        ]);

        walletServiceMock.getWalletById.mockResolvedValue({
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
                userId: 'user-1',
                tokenId: 'token-1',
                toWalletId: 'wallet-2',
                amount: 1000n,
            }),
        ).rejects.toThrow('RPC failure');

        expect(ledgerMock.markFailed).toHaveBeenCalledWith('tx-123');
    });

    it('should throw wallet not found when user has no wallets', async () => {
        tokenServiceMock.getToken.mockResolvedValue({
            id: 'token-1',
            contractAddress: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
        });

        walletServiceMock.getUserWallets.mockResolvedValue([]);

        await expect(
            service.transfer({
                tenantId: 'tenant-1',
                userId: 'user-1',
                tokenId: 'token-1',
                toWalletId: 'wallet-2',
                amount: 1000n,
            }),
        ).rejects.toMatchObject({
            statusCode: 404,
            code: 'WALLET_NOT_FOUND',
        });

        expect(ledgerMock.createPending).not.toHaveBeenCalled();
    });

    it('should throw wallet not found when destination wallet does not exist', async () => {
        tokenServiceMock.getToken.mockResolvedValue({
            id: 'token-1',
            contractAddress: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
        });

        walletServiceMock.getUserWallets.mockResolvedValue([
            {
                id: 'wallet-1',
                address: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
            },
        ]);

        walletServiceMock.getWalletById.mockResolvedValue(null);

        await expect(
            service.transfer({
                tenantId: 'tenant-1',
                userId: 'user-1',
                tokenId: 'token-1',
                toWalletId: 'wallet-2',
                amount: 1000n,
            }),
        ).rejects.toMatchObject({
            statusCode: 404,
            code: 'WALLET_NOT_FOUND',
        });

        expect(ledgerMock.createPending).not.toHaveBeenCalled();
    });
});
