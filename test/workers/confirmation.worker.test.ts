import { describe, it, expect, vi, beforeEach } from 'vitest';

import { TransactionRepository } from '../../src/repositories/transaction.repository.js';
import * as metrics from '../../src/observability/metrics.js';

import {
    transactionsConfirmedTotal,
    transactionsRevertedTotal,
    transactionsFailedTotal,
    transactionConfirmationDurationSeconds,
} from '../../src/observability/transaction.metrics.js';

vi.mock('../../src/services/outbox-event.service.js', () => ({
    outboxEventService: {
        createInTransaction: vi.fn().mockResolvedValue(undefined),
    },
}));

vi.mock('../../src/database/prisma.js', () => ({
    prisma: {
        $transaction: vi.fn(async (callback) => callback({})),
    },
}));

import { ConfirmationProcessor } from '../../src/workers/confirmation.processor.js';
import { outboxEventService } from '../../src/services/outbox-event.service.js';

describe('ConfirmationProcessor', () => {
    const repoMock = {
        findById: vi.fn(),
        confirm: vi.fn(),
        updateStatus: vi.fn(),
        markFailed: vi.fn(),
        markConfirming: vi.fn(),
    };

    const adapterMock = {
        submitTransfer: vi.fn(),
        getTransaction: vi.fn(),
    };

    const blockchainRegistryMock = {
        get: vi.fn().mockReturnValue(adapterMock),
    };

    let processor: ConfirmationProcessor;

    beforeEach(() => {
        vi.clearAllMocks();

        blockchainRegistryMock.get.mockReturnValue(adapterMock);

        processor = new ConfirmationProcessor(
            repoMock as unknown as TransactionRepository,
            blockchainRegistryMock as any,
        );
    });

    const baseTransaction = {
        id: 'tx-1',
        txHash: `0x${'11'.repeat(32)}`,
        tenantId: 'tenant-1',
        tokenId: 'token-1',
        token: {
            blockchain: 'EVM',
        },
    };

    it('should confirm successful blockchain transaction through the adapter', async () => {
        const confirmedAt = new Date();

        repoMock.findById.mockResolvedValue(baseTransaction);

        repoMock.confirm.mockResolvedValue({
            id: 'tx-1',
            tenantId: 'tenant-1',
            tokenId: 'token-1',
            txHash: baseTransaction.txHash,
            blockNumber: 100,
            amount: 1000000n,
            confirmedAt,
        });

        adapterMock.getTransaction.mockResolvedValue({
            txHash: baseTransaction.txHash,
            blockNumber: 100n,
            confirmations: 1,
            status: 'confirmed',
            gasUsed: 50000n,
        });

        await processor.processTransaction('tx-1', 'tenant-1');

        expect(blockchainRegistryMock.get).toHaveBeenCalledWith('EVM');
        expect(adapterMock.getTransaction).toHaveBeenCalledWith(baseTransaction.txHash);

        expect(repoMock.confirm).toHaveBeenCalledWith(
            baseTransaction.txHash,
            {
                blockNumber: 100,
                gasUsed: 50000n,
            },
            expect.anything(),
        );

        expect(outboxEventService.createInTransaction).toHaveBeenCalledWith(expect.anything(), {
            aggregateId: 'tx-1',
            type: 'transaction.confirmed',
            payload: {
                transactionId: 'tx-1',
                tenantId: 'tenant-1',
                tokenId: 'token-1',
                txHash: baseTransaction.txHash,
                blockNumber: '100',
                amount: '1000000',
                confirmedAt: confirmedAt.toISOString(),
            },
        });
    });

    it('should mark transaction failed when adapter reports a failed transaction', async () => {
        repoMock.findById.mockResolvedValue(baseTransaction);

        adapterMock.getTransaction.mockResolvedValue({
            txHash: baseTransaction.txHash,
            blockNumber: 100n,
            confirmations: 1,
            status: 'failed',
            gasUsed: 50000n,
        });

        await processor.processTransaction('tx-1', 'tenant-1');

        expect(repoMock.markFailed).toHaveBeenCalledWith('tx-1', 'FAILED');
        expect(repoMock.confirm).not.toHaveBeenCalled();
        expect(outboxEventService.createInTransaction).not.toHaveBeenCalled();
    });

    it('should record confirmation metrics when transaction is confirmed', async () => {
        const incrementSpy = vi.spyOn(metrics, 'incrementMetric');
        const observeSpy = vi.spyOn(metrics, 'observeMetric');

        repoMock.findById.mockResolvedValue(baseTransaction);

        repoMock.confirm.mockResolvedValue({
            id: 'tx-1',
            tenantId: 'tenant-1',
            tokenId: 'token-1',
            txHash: baseTransaction.txHash,
            blockNumber: 100,
            amount: 1000000n,
            confirmedAt: new Date(),
        });

        adapterMock.getTransaction.mockResolvedValue({
            txHash: baseTransaction.txHash,
            blockNumber: 100n,
            confirmations: 1,
            status: 'confirmed',
            gasUsed: 21000n,
        });

        await processor.processTransaction('tx-1', 'tenant-1');

        expect(incrementSpy).toHaveBeenCalledWith(transactionsConfirmedTotal, {
            tenantId: 'tenant-1',
            tokenId: 'token-1',
        });

        expect(observeSpy).toHaveBeenCalledWith(
            transactionConfirmationDurationSeconds,
            expect.any(Number),
            {
                tenantId: 'tenant-1',
                tokenId: 'token-1',
            },
        );

        expect(repoMock.confirm).toHaveBeenCalledTimes(1);
        expect(outboxEventService.createInTransaction).toHaveBeenCalledTimes(1);
    });

    it('should record reverted transaction metric when adapter reports failure', async () => {
        const incrementSpy = vi.spyOn(metrics, 'incrementMetric');

        repoMock.findById.mockResolvedValue(baseTransaction);

        adapterMock.getTransaction.mockResolvedValue({
            txHash: baseTransaction.txHash,
            blockNumber: 101n,
            confirmations: 1,
            status: 'failed',
            gasUsed: 30000n,
        });

        await processor.processTransaction('tx-1', 'tenant-1');

        expect(incrementSpy).toHaveBeenCalledWith(transactionsRevertedTotal, {
            tenantId: 'tenant-1',
            tokenId: 'token-1',
        });

        expect(outboxEventService.createInTransaction).not.toHaveBeenCalled();
    });

    it('should retry (not fail) a Bitcoin-style transaction the adapter reports as pending', async () => {
        // This is the case the tri-state status exists for: a Bitcoin
        // transaction still sitting unconfirmed in the mempool used to
        // be reported as success:false and get marked FAILED on the
        // very first poll. It must now be treated as retryable, the
        // same way an EVM receipt-not-found-yet is.
        const incrementSpy = vi.spyOn(metrics, 'incrementMetric');

        const bitcoinTransaction = {
            ...baseTransaction,
            token: { blockchain: 'BITCOIN' },
        };

        repoMock.findById.mockResolvedValue(bitcoinTransaction);

        adapterMock.getTransaction.mockResolvedValue({
            txHash: baseTransaction.txHash,
            blockNumber: null,
            confirmations: 0,
            status: 'pending',
            gasUsed: null,
        });

        await expect(processor.processTransaction('tx-1', 'tenant-1')).rejects.toThrow(
            'is still pending confirmation',
        );

        expect(repoMock.markFailed).not.toHaveBeenCalled();
        expect(repoMock.confirm).not.toHaveBeenCalled();
        expect(outboxEventService.createInTransaction).not.toHaveBeenCalled();

        // Pending is expected, ordinary polling — it must not inflate the
        // same failure metric a genuine confirmation error would.
        expect(incrementSpy).not.toHaveBeenCalledWith(
            transactionsFailedTotal,
            expect.objectContaining({ status: 'CONFIRMATION_ERROR' }),
        );
    });

    it('should retry (not fail) when Bitcoin Core reports the transaction not found yet', async () => {
        repoMock.findById.mockResolvedValue({
            ...baseTransaction,
            token: { blockchain: 'BITCOIN' },
        });

        adapterMock.getTransaction.mockRejectedValue(
            new Error(
                'No such mempool or blockchain transaction. Use gettransaction for wallet transactions.',
            ),
        );

        const incrementSpy = vi.spyOn(metrics, 'incrementMetric');

        await expect(processor.processTransaction('tx-1', 'tenant-1')).rejects.toThrow(
            'No such mempool or blockchain transaction',
        );

        expect(incrementSpy).not.toHaveBeenCalledWith(
            transactionsFailedTotal,
            expect.objectContaining({ status: 'CONFIRMATION_ERROR' }),
        );
    });

    it('should record failed transaction metric when adapter lookup throws', async () => {
        const incrementSpy = vi.spyOn(metrics, 'incrementMetric');

        repoMock.findById.mockResolvedValue(baseTransaction);
        adapterMock.getTransaction.mockRejectedValue(new Error('RPC connection failed'));

        await expect(processor.processTransaction('tx-1', 'tenant-1')).rejects.toThrow(
            'RPC connection failed',
        );

        expect(incrementSpy).toHaveBeenCalledWith(transactionsFailedTotal, {
            tenantId: 'tenant-1',
            tokenId: 'token-1',
            status: 'CONFIRMATION_ERROR',
        });

        expect(outboxEventService.createInTransaction).not.toHaveBeenCalled();
    });
});
