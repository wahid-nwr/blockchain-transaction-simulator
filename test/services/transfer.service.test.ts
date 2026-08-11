import { describe, it, expect, vi, beforeEach } from 'vitest';

import { TransferService } from '../../src/services/transfer.service.js';

import { transactionConfirmationQueue } from '../../src/queues/index.js';

import { JOBS } from '../../src/queues/job.constants.js';

vi.mock('../../src/queues/index.js', () => ({
    transactionConfirmationQueue: {
        add: vi.fn(),
    },
}));

vi.mock('../../src/observability/transaction.logger.js', () => ({
    logTransactionEvent: vi.fn(),
}));

vi.mock('../../src/observability/metrics.js', () => ({
    registerMetric: vi.fn(),
    incrementMetric: vi.fn(),
    observeMetric: vi.fn(),
}));

describe('TransferService', () => {
    const ledgerMock = {
        createPending: vi.fn(),

        attachHash: vi.fn(),

        markFailed: vi.fn(),
    };

    const walletServiceMock = {
        getWalletById: vi.fn(),
    };

    const tokenServiceMock = {
        getToken: vi.fn(),
    };

    const signerServiceMock = {
        getWalletClientFor: vi.fn(),
    };

    let service: TransferService;

    beforeEach(() => {
        vi.clearAllMocks();

        service = new TransferService(
            ledgerMock as any,
            walletServiceMock as any,
            tokenServiceMock as any,
            signerServiceMock as any,
        );
    });

    it('should submit transaction and enqueue confirmation job', async () => {
        const request = {
            tenantId: 'tenant-1',

            userId: 'user-1',

            tokenId: 'token-1',

            fromWalletId: 'wallet-1',

            toWalletId: 'wallet-2',

            amount: 100n,
        };

        tokenServiceMock.getToken.mockResolvedValue({
            id: 'token-1',

            contractAddress: '0xcontract',

            decimals: 6,
        });

        walletServiceMock.getWalletById.mockImplementation(async (id: string) => {
            if (id === 'wallet-1') {
                return {
                    id: 'wallet-1',

                    tenantId: 'tenant-1',

                    ownerId: 'user-1',

                    address: '0xfrom',
                };
            }

            return {
                id: 'wallet-2',

                tenantId: 'tenant-1',

                address: '0xto',
            };
        });

        ledgerMock.createPending.mockResolvedValue({
            id: 'tx-1',

            tenantId: 'tenant-1',

            tokenId: 'token-1',

            status: 'PENDING',
        });

        const writeContract = vi.fn().mockResolvedValue('0xhash');

        signerServiceMock.getWalletClientFor.mockResolvedValue({
            writeContract,
        });

        ledgerMock.attachHash.mockResolvedValue({
            id: 'tx-1',

            tenantId: 'tenant-1',

            tokenId: 'token-1',

            txHash: '0xhash',

            status: 'SUBMITTED',
        });

        await service.transfer(request);

        expect(ledgerMock.attachHash).toHaveBeenCalledWith('tx-1', '0xhash');

        expect(transactionConfirmationQueue.add).toHaveBeenCalledWith(
            JOBS.CONFIRM_TRANSACTION,

            {
                transactionId: 'tx-1',
                tenantId: 'tenant-1',
            },

            {
                attempts: 5,

                backoff: {
                    type: 'exponential',
                    delay: 5000,
                },

                removeOnComplete: true,

                removeOnFail: false,
            },
        );
    });

    it('should mark transaction failed when submission fails', async () => {
        const request = {
            tenantId: 'tenant-1',

            userId: 'user-1',

            tokenId: 'token-1',

            fromWalletId: 'wallet-1',

            toWalletId: 'wallet-2',

            amount: 100n,
        };

        tokenServiceMock.getToken.mockResolvedValue({
            id: 'token-1',

            contractAddress: '0xcontract',

            decimals: 6,
        });

        walletServiceMock.getWalletById.mockResolvedValue({
            id: 'wallet-1',

            tenantId: 'tenant-1',

            ownerId: 'user-1',
        });

        ledgerMock.createPending.mockResolvedValue({
            id: 'tx-1',
        });

        signerServiceMock.getWalletClientFor.mockRejectedValue(new Error('wallet unavailable'));

        ledgerMock.markFailed.mockResolvedValue({
            id: 'tx-1',

            status: 'FAILED',
        });

        await service.transfer(request);

        expect(ledgerMock.markFailed).toHaveBeenCalledWith('tx-1', 'wallet unavailable');
    });
});
