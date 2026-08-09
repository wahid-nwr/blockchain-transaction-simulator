import { describe, it, expect, vi, beforeEach } from 'vitest';

import { TransferService } from '../../src/services/transfer.service.js';

import { publicClient } from '../../src/blockchain/client.js';
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

    // Stands in for the resolved server-side signer — nothing here comes from
    // a request body anymore, so the test never constructs a raw private key.
    const signerServiceMock = {
        getWalletClientFor: vi.fn(),
    };

    const fromWalletAddress = '0x3C44CdDd6a900fa2b585dd299e03d12FA4293BC';

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

        walletServiceMock.getWalletById.mockImplementation(async (id: string) => {
            if (id === 'wallet-from') {
                return {
                    id: 'wallet-from',
                    tenantId: 'tenant-1',
                    ownerId: 'user-1',
                    address: fromWalletAddress,
                };
            }
            if (id === 'wallet-to' || id === 'wallet-2') {
                return {
                    id,
                    tenantId: 'tenant-1',
                    ownerId: 'someone-else',
                    address: '0x0000000000000000000000000000000000000002',
                };
            }
            return null;
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

    function buildService() {
        return new TransferService(
            ledgerMock as any,
            walletServiceMock as any,
            tokenServiceMock as any,
            signerServiceMock as any,
        );
    }

    it('should create pending transaction and attach blockchain hash', async () => {
        const walletClientMock = {
            account: { address: fromWalletAddress },
            writeContract: vi.fn().mockResolvedValue('0xtransactionhash'),
        };
        signerServiceMock.getWalletClientFor.mockResolvedValue(walletClientMock);

        const service = buildService();

        const result = await service.transfer({
            tenantId: 'tenant-1',
            userId: 'user-1',
            tokenId: 'token-1',
            fromWalletId: 'wallet-from',
            toWalletId: 'wallet-to',
            amount: 1000n,
        });

        expect(ledgerMock.createPending).toHaveBeenCalled();
        expect(signerServiceMock.getWalletClientFor).toHaveBeenCalledWith(
            'wallet-from',
            'tenant-1',
        );
        expect(walletClientMock.writeContract).toHaveBeenCalled();

        const call = walletClientMock.writeContract.mock.calls[0][0];
        expect(call.args).toEqual(['0x0000000000000000000000000000000000000002', 1000000000n]);

        expect(ledgerMock.attachHash).toHaveBeenCalledWith('tx-123', '0xtransactionhash');
        expect(publicClient.waitForTransactionReceipt).not.toHaveBeenCalled();
        expect(result.txHash).toBe('0xtransactionhash');
    });

    it('should reject a transfer from a wallet the user does not own', async () => {
        walletServiceMock.getWalletById.mockImplementation(async (id: string) => {
            if (id === 'wallet-from') {
                return {
                    id: 'wallet-from',
                    tenantId: 'tenant-1',
                    ownerId: 'someone-else', // not 'user-1'
                    address: fromWalletAddress,
                };
            }
            return null;
        });

        const service = buildService();

        await expect(
            service.transfer({
                tenantId: 'tenant-1',
                userId: 'user-1',
                tokenId: 'token-1',
                fromWalletId: 'wallet-from',
                toWalletId: 'wallet-to',
                amount: 1000n,
            }),
        ).rejects.toMatchObject({ statusCode: 404 });

        expect(ledgerMock.createPending).not.toHaveBeenCalled();
        expect(signerServiceMock.getWalletClientFor).not.toHaveBeenCalled();
    });

    it('marks the transaction failed when the wallet is not custodial', async () => {
        signerServiceMock.getWalletClientFor.mockRejectedValue(
            Object.assign(new Error('Wallet not custodial'), { code: 'WALLET_NOT_CUSTODIAL' }),
        );

        const service = buildService();

        const result = await service.transfer({
            tenantId: 'tenant-1',
            userId: 'user-1',
            tokenId: 'token-1',
            fromWalletId: 'wallet-from',
            toWalletId: 'wallet-to',
            amount: 1000n,
        });

        // createPending already ran, so failure is recorded on the ledger
        // rather than surfacing as an unhandled request error.
        expect(ledgerMock.markFailed).toHaveBeenCalledWith('tx-123', 'Wallet not custodial');
        expect(result).toMatchObject({ id: 'tx-123', status: 'FAILED' });
    });

    it('should mark transaction failed when blockchain transfer fails', async () => {
        const walletClientMock = {
            account: { address: fromWalletAddress },
            writeContract: vi.fn().mockRejectedValue(new Error('RPC failure')),
        };
        signerServiceMock.getWalletClientFor.mockResolvedValue(walletClientMock);

        const service = buildService();

        const result = await service.transfer({
            tenantId: 'tenant-1',
            userId: 'user-1',
            tokenId: 'token-1',
            fromWalletId: 'wallet-from',
            toWalletId: 'wallet-to',
            amount: 1000n,
        });

        expect(ledgerMock.markFailed).toHaveBeenCalledWith('tx-123', 'RPC failure');
        expect(result).toMatchObject({
            id: 'tx-123',
            status: 'FAILED',
        });
    });

    it('should not wait for receipt after submitting transaction', async () => {
        const walletClientMock = {
            account: { address: fromWalletAddress },
            writeContract: vi.fn().mockResolvedValue('0xtransactionhash'),
        };
        signerServiceMock.getWalletClientFor.mockResolvedValue(walletClientMock);

        const service = buildService();

        await service.transfer({
            tenantId: 'tenant-1',
            userId: 'user-1',
            tokenId: 'token-1',
            fromWalletId: 'wallet-from',
            toWalletId: 'wallet-to',
            amount: 1000n,
        });

        expect(publicClient.waitForTransactionReceipt).not.toHaveBeenCalled();
    });

    it('should record transaction submission metrics', async () => {
        const incrementSpy = vi.spyOn(metrics, 'incrementMetric');
        const observeSpy = vi.spyOn(metrics, 'observeMetric');

        signerServiceMock.getWalletClientFor.mockResolvedValue({
            writeContract: vi.fn().mockResolvedValue('0xtransactionhash'),
        });

        const service = buildService();

        const result = await service.transfer({
            tenantId: 'tenant-1',
            userId: 'user-1',
            tokenId: 'token-1',
            fromWalletId: 'wallet-from',
            toWalletId: 'wallet-2',
            amount: 100n,
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
