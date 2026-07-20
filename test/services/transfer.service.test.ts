import { describe, it, expect, vi, beforeEach } from 'vitest';

import * as blockchainClient from '../../src/blockchain/client.js';
import { Signer } from '../../src/blockchain/signer.js';

import { TransferService } from '../../src/services/transfer.service.js';
import { LedgerService } from '../../src/services/ledger.service.js';
import { WalletService } from '../../src/services/wallet.service.js';
import { TokenService } from '../../src/services/token.service.js';

describe('TransferService', () => {
    const signer: Signer = {
        address: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
        privateKey: '0x59c6995e998f97a5a0044966f094538e5d9d3154b79b6c8b8b6d5a8f8f8f8f',
    };

    const writeContractMock = vi.fn();

    const waitForTransactionReceiptMock = vi.fn();

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
        vi.restoreAllMocks();
        vi.clearAllMocks();

        writeContractMock.mockReset();
        waitForTransactionReceiptMock.mockReset();

        vi.spyOn(blockchainClient, 'getWalletClient').mockReturnValue({
            account: {
                address: signer.address,
            },
            writeContract: writeContractMock,
        } as any);

        vi.spyOn(blockchainClient.publicClient, 'waitForTransactionReceipt').mockImplementation(
            waitForTransactionReceiptMock,
        );

        service = new TransferService(
            ledgerMock as unknown as LedgerService,
            walletServiceMock as unknown as WalletService,
            tokenServiceMock as unknown as TokenService,
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
                address: signer.address,
            },
        ]);

        walletServiceMock.getWalletById.mockResolvedValue({
            id: 'wallet-2',
            address: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
        });

        ledgerMock.createPending.mockResolvedValue({
            id: 'tx-123',
        });

        writeContractMock.mockResolvedValue('0xtransactionhash');

        waitForTransactionReceiptMock.mockResolvedValue({
            transactionHash: '0xtransactionhash',
            gasUsed: 22400n,
            logs: [],
        });

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

            signer: signer,
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

        expect(blockchainClient.getWalletClient).toHaveBeenCalledWith(signer.privateKey);

        expect(writeContractMock).toHaveBeenCalled();

        const call = writeContractMock.mock.calls[0][0];

        expect(call).toEqual(
            expect.objectContaining({
                address: '0x5FbDB2315678afecb367f032d93F642f64180aa3',

                functionName: 'transfer',
            }),
        );

        expect(call.args).toEqual(['0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC', 1000n]);

        expect(waitForTransactionReceiptMock).toHaveBeenCalledWith({
            hash: '0xtransactionhash',
        });

        expect(ledgerMock.attachHash).toHaveBeenCalledWith('tx-123', '0xtransactionhash');

        expect(result).toEqual({
            id: 'tx-123',

            txHash: '0xtransactionhash',
        });
    });

    it('should mark transaction failed when blockchain transfer fails', async () => {
        tokenServiceMock.getToken.mockResolvedValue({
            contractAddress: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
        });

        walletServiceMock.getUserWallets.mockResolvedValue([
            {
                id: 'wallet-1',
                address: signer.address,
            },
        ]);

        walletServiceMock.getWalletById.mockResolvedValue({
            id: 'wallet-2',
            address: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
        });

        ledgerMock.createPending.mockResolvedValue({
            id: 'tx-123',
        });

        writeContractMock.mockRejectedValue(new Error('RPC failure'));

        await expect(
            service.transfer({
                tenantId: 'tenant-1',

                userId: 'user-1',

                tokenId: 'token-1',

                toWalletId: 'wallet-2',

                amount: 1000n,

                signer: signer,
            }),
        ).rejects.toThrow('RPC failure');

        expect(ledgerMock.markFailed).toHaveBeenCalledWith('tx-123');

        expect(waitForTransactionReceiptMock).not.toHaveBeenCalled();
    });

    it('should propagate receipt failure', async () => {
        tokenServiceMock.getToken.mockResolvedValue({
            contractAddress: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
        });

        walletServiceMock.getUserWallets.mockResolvedValue([
            {
                id: 'wallet-1',
                address: signer.address,
            },
        ]);

        walletServiceMock.getWalletById.mockResolvedValue({
            id: 'wallet-2',
            address: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
        });

        ledgerMock.createPending.mockResolvedValue({
            id: 'tx-123',
        });

        writeContractMock.mockResolvedValue('0xtransactionhash');

        waitForTransactionReceiptMock.mockRejectedValue(new Error('Receipt timeout'));

        await expect(
            service.transfer({
                tenantId: 'tenant-1',

                userId: 'user-1',

                tokenId: 'token-1',

                toWalletId: 'wallet-2',

                amount: 1000n,

                signer: signer,
            }),
        ).rejects.toThrow('Receipt timeout');

        expect(ledgerMock.attachHash).not.toHaveBeenCalled();
    });

    it('should throw wallet not found when user has no wallets', async () => {
        walletServiceMock.getUserWallets.mockResolvedValue([]);

        await expect(
            service.transfer({
                tenantId: 'tenant-1',

                userId: 'user-1',

                tokenId: 'token-1',

                toWalletId: 'wallet-2',

                amount: 1000n,

                signer: signer,
            }),
        ).rejects.toMatchObject({
            statusCode: 404,

            code: 'WALLET_NOT_FOUND',
        });

        expect(ledgerMock.createPending).not.toHaveBeenCalled();
    });

    it('should throw wallet not found when destination wallet does not exist', async () => {
        walletServiceMock.getUserWallets.mockResolvedValue([
            {
                id: 'wallet-1',
                address: signer.address,
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

                signer: signer,
            }),
        ).rejects.toMatchObject({
            statusCode: 404,

            code: 'WALLET_NOT_FOUND',
        });

        expect(ledgerMock.createPending).not.toHaveBeenCalled();
    });
});
