import { describe, it, expect, vi, beforeEach } from 'vitest';

import { TransferService } from '../../src/services/transfer.service.js';

import type { Signer } from '../../src/blockchain/signer.js';

import { publicClient, getWalletClient } from '../../src/blockchain/client.js';
import * as metrics from '../../src/observability/metrics.js';

import {
    transactionsSubmittedTotal,
    transactionSubmissionDurationSeconds,
} from '../../src/observability/transaction.metrics.js';

vi.mock('../../src/blockchain/client.js', () => ({
    publicClient: {
        waitForTransactionReceipt: vi.fn(),
    },

    getWalletClient: vi.fn(),
}));

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

    const signer: Signer = {
        address: '0x3C44CdDd6a900fa2b585dd299e03d12FA4293BC',

        privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
    };

    const transaction = {
        id: 'tx-123',
        status: 'PENDING',
    };

    beforeEach(() => {
        vi.clearAllMocks();

        tokenServiceMock.getToken.mockResolvedValue({
            contractAddress: '0x0000000000000000000000000000000000000001',

            decimals: 6,
        });

        walletServiceMock.getUserWallets.mockResolvedValue([
            {
                id: 'wallet-from',
                address: signer.address,
            },
        ]);

        walletServiceMock.getWalletById.mockResolvedValue({
            id: 'wallet-to',
            address: '0x0000000000000000000000000000000000000002',
        });

        ledgerMock.createPending.mockResolvedValue(transaction);

        ledgerMock.attachHash.mockResolvedValue({
            ...transaction,
            txHash: '0xtransactionhash',
        });

        ledgerMock.markFailed.mockResolvedValue({
            id: 'tx-123',
            status: 'FAILED',
            failureReason: 'RPC failure',
        });
    });

    it('should create pending transaction and attach blockchain hash', async () => {
        const walletClientMock = {
            account: {
                address: signer.address,
            },

            writeContract: vi.fn().mockResolvedValue('0xtransactionhash'),
        };

        vi.mocked(getWalletClient).mockReturnValue(walletClientMock as any);

        const service = new TransferService(
            ledgerMock as any,
            walletServiceMock as any,
            tokenServiceMock as any,
        );

        const result = await service.transfer({
            tenantId: 'tenant-1',

            userId: 'user-1',

            tokenId: 'token-1',

            toWalletId: 'wallet-to',

            amount: 1000n,

            signer,
        });

        expect(ledgerMock.createPending).toHaveBeenCalled();

        expect(walletClientMock.writeContract).toHaveBeenCalled();

        const call = walletClientMock.writeContract.mock.calls[0][0];

        expect(call.args).toEqual(['0x0000000000000000000000000000000000000002', 1000000000n]);

        expect(ledgerMock.attachHash).toHaveBeenCalledWith('tx-123', '0xtransactionhash');

        expect(publicClient.waitForTransactionReceipt).not.toHaveBeenCalled();

        expect(result.txHash).toBe('0xtransactionhash');
    });

    it('should mark transaction failed when blockchain transfer fails', async () => {
        const walletClientMock = {
            account: {
                address: signer.address,
            },

            writeContract: vi.fn().mockRejectedValue(new Error('RPC failure')),
        };

        vi.mocked(getWalletClient).mockReturnValue(walletClientMock as any);

        const service = new TransferService(
            ledgerMock as any,
            walletServiceMock as any,
            tokenServiceMock as any,
        );

        const result = await service.transfer({
            tenantId: 'tenant-1',

            userId: 'user-1',

            tokenId: 'token-1',

            toWalletId: 'wallet-to',

            amount: 1000n,

            signer,
        });

        expect(ledgerMock.markFailed).toHaveBeenCalledWith('tx-123', 'RPC failure');

        expect(result).toMatchObject({
            id: 'tx-123',
            status: 'FAILED',
        });
    });

    it('should not wait for receipt after submitting transaction', async () => {
        const walletClientMock = {
            account: {
                address: signer.address,
            },

            writeContract: vi.fn().mockResolvedValue('0xtransactionhash'),
        };

        vi.mocked(getWalletClient).mockReturnValue(walletClientMock as any);

        const service = new TransferService(
            ledgerMock as any,
            walletServiceMock as any,
            tokenServiceMock as any,
        );

        await service.transfer({
            tenantId: 'tenant-1',

            userId: 'user-1',

            tokenId: 'token-1',

            toWalletId: 'wallet-to',

            amount: 1000n,

            signer,
        });

        expect(publicClient.waitForTransactionReceipt).not.toHaveBeenCalled();
    });

    it('should record transaction submission metrics', async () => {
        const incrementSpy = vi.spyOn(metrics, 'incrementMetric');

        const observeSpy = vi.spyOn(metrics, 'observeMetric');

        vi.mocked(getWalletClient).mockReturnValue({
            writeContract: vi.fn().mockResolvedValue('0xtransactionhash'),
        } as any);

        const service = new TransferService(
            ledgerMock as any,
            walletServiceMock as any,
            tokenServiceMock as any,
        );

        const result = await service.transfer({
            tenantId: 'tenant-1',
            userId: 'user-1',
            tokenId: 'token-1',
            toWalletId: 'wallet-2',
            amount: 100n,
            signer,
        });

        expect(result).toBeDefined();

        expect(incrementSpy).toHaveBeenCalledWith(transactionsSubmittedTotal, {
            tenantId: result.tenantId,
            tokenId: result.tokenId,
        });

        expect(observeSpy).toHaveBeenCalledWith(
            transactionSubmissionDurationSeconds,
            expect.any(Number),
            {
                tenantId: result.tenantId,
                tokenId: result.tokenId,
            },
        );
    });
});
