import { describe, it, expect, vi, beforeEach } from 'vitest';

import { TransactionRepository } from '../../src/repositories/transaction.repository.js';

import * as metrics from '../../src/observability/metrics.js';

import {
    transactionsConfirmedTotal,
    transactionsRevertedTotal,
    transactionsFailedTotal,
    transactionConfirmationDurationSeconds,
} from '../../src/observability/transaction.metrics.js';

vi.mock('../../src/blockchain/client.js', () => ({
    publicClient: {
        getTransactionReceipt: vi.fn(),
    },
}));

vi.mock('../../src/blockchain/rpc.instrumentation.js', () => ({
    instrumentRpc: vi.fn(async (_method: string, fn: () => Promise<unknown>) => fn()),
}));

import { ConfirmationProcessor } from '../../src/workers/confirmation.processor.js';

import { publicClient } from '../../src/blockchain/client.js';

import { instrumentRpc } from '../../src/blockchain/rpc.instrumentation.js';

describe('ConfirmationProcessor', () => {
    const repoMock = {
        findById: vi.fn(),

        confirm: vi.fn(),

        updateStatus: vi.fn(),

        markFailed: vi.fn(),

        markConfirming: vi.fn(),
    };

    let processor: ConfirmationProcessor;

    beforeEach(() => {
        vi.clearAllMocks();

        vi.mocked(instrumentRpc).mockImplementation(async (_method, fn) => fn());

        processor = new ConfirmationProcessor(repoMock as unknown as TransactionRepository);
    });

    it('should confirm successful blockchain transaction', async () => {
        const txHash = `0x${'11'.repeat(32)}`;
        repoMock.findById.mockResolvedValue({
            id: 'tx-1',

            txHash: txHash,

            tenantId: 'tenant-1',

            tokenId: 'token-1',
        });

        vi.mocked(publicClient.getTransactionReceipt).mockResolvedValue({
            status: 'success',

            blockNumber: 100n,

            gasUsed: 50000n,
        } as any);

        await processor.processTransaction('tx-1', 'tenant-1');

        expect(instrumentRpc).toHaveBeenCalledWith('getTransactionReceipt', expect.any(Function));

        expect(repoMock.confirm).toHaveBeenCalledWith(txHash, {
            blockNumber: 100,

            gasUsed: 50000n,
        });
    });

    it('should mark transaction failed when receipt fails', async () => {
        const txHash = `0x${'11'.repeat(32)}`;
        repoMock.findById.mockResolvedValue({
            id: 'tx-1',

            txHash: txHash,

            tenantId: 'tenant-1',

            tokenId: 'token-1',
        });

        vi.mocked(publicClient.getTransactionReceipt).mockResolvedValue({
            status: 'reverted',

            blockNumber: 100n,

            gasUsed: 50000n,
        } as any);

        await processor.processTransaction('tx-1', 'tenant-1');

        expect(repoMock.markFailed).toHaveBeenCalledWith('tx-1', 'FAILED');
    });

    it('should record confirmation metrics when transaction is confirmed', async () => {
        const incrementSpy = vi.spyOn(metrics, 'incrementMetric');

        const observeSpy = vi.spyOn(metrics, 'observeMetric');

        const txHash = `0x${'11'.repeat(32)}`;
        repoMock.findById.mockResolvedValue({
            id: 'tx-1',

            txHash: txHash,

            tenantId: 'tenant-1',

            tokenId: 'token-1',
        });

        vi.mocked(publicClient.getTransactionReceipt).mockResolvedValue({
            status: 'success',

            blockNumber: 100n,

            gasUsed: 21000n,
        } as any);

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
    });

    it('should record reverted transaction metric when receipt fails', async () => {
        const incrementSpy = vi.spyOn(metrics, 'incrementMetric');

        const txHash = `0x${'11'.repeat(32)}`;
        repoMock.findById.mockResolvedValue({
            id: 'tx-1',

            txHash: txHash,

            tenantId: 'tenant-1',

            tokenId: 'token-1',
        });

        vi.mocked(publicClient.getTransactionReceipt).mockResolvedValue({
            status: 'reverted',

            blockNumber: 101n,

            gasUsed: 30000n,
        } as any);

        await processor.processTransaction('tx-1', 'tenant-1');

        expect(incrementSpy).toHaveBeenCalledWith(transactionsRevertedTotal, {
            tenantId: 'tenant-1',

            tokenId: 'token-1',
        });
    });

    it('should record failed transaction metric when confirmation throws error', async () => {
        const incrementSpy = vi.spyOn(metrics, 'incrementMetric');

        const txHash = `0x${'11'.repeat(32)}`;
        repoMock.findById.mockResolvedValue({
            id: 'tx-1',

            txHash: txHash,

            tenantId: 'tenant-1',

            tokenId: 'token-1',
        });

        vi.mocked(publicClient.getTransactionReceipt).mockRejectedValue(
            new Error('RPC connection failed'),
        );

        await expect(processor.processTransaction('tx-1', 'tenant-1')).rejects.toThrow(
            'RPC connection failed',
        );

        expect(incrementSpy).toHaveBeenCalledWith(transactionsFailedTotal, {
            tenantId: 'tenant-1',

            tokenId: 'token-1',

            status: 'CONFIRMATION_ERROR',
        });
    });
});
