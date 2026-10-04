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
        markSubmitted: vi.fn(),
        markFailed: vi.fn(),
    };

    const walletServiceMock = {
        getWalletById: vi.fn(),
        getCustodyStatus: vi.fn(),
    };

    const tokenServiceMock = {
        getToken: vi.fn(),
    };

    const adapterMock = {
        submitTransfer: vi.fn(),
        getTransaction: vi.fn(),
        canSign: vi.fn(),
    };

    const blockchainRegistryMock = {
        get: vi.fn().mockReturnValue(adapterMock),
    };

    let service: TransferService;

    beforeEach(() => {
        vi.clearAllMocks();

        blockchainRegistryMock.get.mockReturnValue(adapterMock);

        // Default: a signable wallet. Individual tests override to cover the
        // precondition.
        walletServiceMock.getCustodyStatus.mockResolvedValue({
            custodyType: 'CUSTODIAL',
            hasCustodyKey: true,
        });
        adapterMock.canSign.mockReturnValue(true);

        service = new TransferService(
            ledgerMock as any,
            walletServiceMock as any,
            tokenServiceMock as any,
            blockchainRegistryMock as any,
        );
    });

    it('should submit transaction through the blockchain adapter and enqueue confirmation job', async () => {
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
            blockchain: 'EVM',
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

        const txHash = `0x${'11'.repeat(32)}`;

        adapterMock.submitTransfer.mockResolvedValue({
            txHash,
        });

        ledgerMock.markSubmitted.mockResolvedValue({
            id: 'tx-1',
            tenantId: 'tenant-1',
            tokenId: 'token-1',
            txHash,
            status: 'SUBMITTED',
        });

        await service.transfer(request);

        expect(blockchainRegistryMock.get).toHaveBeenCalledWith('EVM');

        expect(adapterMock.submitTransfer).toHaveBeenCalledWith({
            tenantId: 'tenant-1',
            walletId: 'wallet-1',
            toAddress: '0xto',
            amount: 100n,
            assetIdentifier: '0xcontract',
        });

        expect(ledgerMock.markSubmitted).toHaveBeenCalledWith('tx-1', txHash);

        expect(transactionConfirmationQueue.add).toHaveBeenCalledWith(JOBS.CONFIRM_TRANSACTION, {
            transactionId: 'tx-1',
            tenantId: 'tenant-1',
        });
    });

    it('should mark transaction failed when confirmation queue enqueue fails', async () => {
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
            blockchain: 'EVM',
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

        const txHash = `0x${'11'.repeat(32)}`;

        adapterMock.submitTransfer.mockResolvedValue({
            txHash,
        });

        ledgerMock.markSubmitted.mockResolvedValue({
            id: 'tx-1',
            tenantId: 'tenant-1',
            tokenId: 'token-1',
            txHash,
            status: 'SUBMITTED',
        });

        vi.mocked(transactionConfirmationQueue.add).mockRejectedValue(
            new Error('Redis unavailable'),
        );

        ledgerMock.markFailed.mockResolvedValue({
            id: 'tx-1',
            status: 'FAILED',
        });

        await service.transfer(request);

        expect(ledgerMock.markSubmitted).toHaveBeenCalledWith('tx-1', txHash);
        expect(transactionConfirmationQueue.add).toHaveBeenCalled();
        expect(ledgerMock.markFailed).toHaveBeenCalledWith('tx-1', 'Redis unavailable');
    });

    it('should mark transaction failed when blockchain adapter submission fails', async () => {
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
            blockchain: 'EVM',
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

        adapterMock.submitTransfer.mockRejectedValue(new Error('wallet unavailable'));

        ledgerMock.markFailed.mockResolvedValue({
            id: 'tx-1',
            status: 'FAILED',
        });

        await service.transfer(request);

        expect(ledgerMock.markFailed).toHaveBeenCalledWith('tx-1', 'wallet unavailable');
    });
    describe('signing precondition', () => {
        const request = {
            tenantId: 'tenant-1',
            userId: 'user-1',
            tokenId: 'token-1',
            fromWalletId: 'wallet-1',
            toWalletId: 'wallet-2',
            amount: 100n,
        };

        beforeEach(() => {
            tokenServiceMock.getToken.mockResolvedValue({
                id: 'token-1',
                blockchain: 'EVM',
                contractAddress: '0xcontract',
                decimals: 6,
            });

            walletServiceMock.getWalletById.mockImplementation(async (id: string) =>
                id === 'wallet-1'
                    ? { id: 'wallet-1', tenantId: 'tenant-1', ownerId: 'user-1', address: '0xfrom' }
                    : { id: 'wallet-2', tenantId: 'tenant-1', address: '0xto' },
            );
        });

        it('rejects a wallet the platform cannot sign for before touching the ledger', async () => {
            walletServiceMock.getCustodyStatus.mockResolvedValue({
                custodyType: 'EXTERNAL',
                hasCustodyKey: false,
            });
            adapterMock.canSign.mockReturnValue(false);

            await expect(service.transfer(request)).rejects.toMatchObject({
                code: 'WALLET_NOT_CUSTODIAL',
                statusCode: 409,
            });

            expect(adapterMock.canSign).toHaveBeenCalledWith({
                custodyType: 'EXTERNAL',
                hasCustodyKey: false,
            });
            // The whole point: no PENDING row, no submission, no FAILED row.
            expect(ledgerMock.createPending).not.toHaveBeenCalled();
            expect(adapterMock.submitTransfer).not.toHaveBeenCalled();
            expect(ledgerMock.markFailed).not.toHaveBeenCalled();
            expect(transactionConfirmationQueue.add).not.toHaveBeenCalled();
        });

        it("asks the adapter of the token's chain, so the decision is per chain", async () => {
            tokenServiceMock.getToken.mockResolvedValue({
                id: 'token-1',
                blockchain: 'BITCOIN',
                contractAddress: null,
                decimals: 8,
            });
            adapterMock.canSign.mockReturnValue(false);

            await expect(service.transfer(request)).rejects.toMatchObject({
                code: 'WALLET_NOT_CUSTODIAL',
            });

            expect(blockchainRegistryMock.get).toHaveBeenCalledWith('BITCOIN');
        });

        it('does not look up custody for a wallet the caller does not own', async () => {
            walletServiceMock.getWalletById.mockResolvedValue({
                id: 'wallet-1',
                tenantId: 'tenant-1',
                ownerId: 'someone-else',
            });

            await expect(service.transfer(request)).rejects.toMatchObject({
                code: 'WALLET_NOT_FOUND',
            });

            expect(walletServiceMock.getCustodyStatus).not.toHaveBeenCalled();
            expect(ledgerMock.createPending).not.toHaveBeenCalled();
        });
    });
});
