import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SubmissionRecoveryProcessor } from '../../src/workers/submission-recovery.processor.js';
import { TransactionRepository } from '../../src/repositories/transaction.repository.js';
import { transactionConfirmationQueue } from '../../src/queues/index.js';
import { JOBS } from '../../src/queues/job.constants.js';

vi.mock('../../src/queues/index.js', () => ({
    transactionConfirmationQueue: {
        add: vi.fn(),
    },
}));

vi.mock('../../src/observability/logger.js', () => ({
    getLogger: vi.fn(() => ({
        info: vi.fn(),
        error: vi.fn(),
    })),
}));

describe('SubmissionRecoveryProcessor', () => {
    const repositoryMock = {
        findSubmittedCandidates: vi.fn(),
    };

    let processor: SubmissionRecoveryProcessor;

    beforeEach(() => {
        vi.clearAllMocks();

        processor = new SubmissionRecoveryProcessor(
            repositoryMock as unknown as TransactionRepository,
        );
    });

    it('should enqueue confirmation jobs for submitted transactions', async () => {
        repositoryMock.findSubmittedCandidates.mockResolvedValue([
            {
                id: 'tx-1',
                tenantId: 'tenant-1',
                txHash: '0xhash1',
                status: 'SUBMITTED',
            },
            {
                id: 'tx-2',
                tenantId: 'tenant-2',
                txHash: '0xhash2',
                status: 'SUBMITTED',
            },
        ]);

        vi.mocked(transactionConfirmationQueue.add).mockResolvedValue({} as never);

        await processor.processSubmittedTransactions();

        expect(repositoryMock.findSubmittedCandidates).toHaveBeenCalledTimes(1);

        expect(transactionConfirmationQueue.add).toHaveBeenCalledTimes(2);

        expect(transactionConfirmationQueue.add).toHaveBeenNthCalledWith(
            1,
            JOBS.CONFIRM_TRANSACTION,
            {
                transactionId: 'tx-1',
                tenantId: 'tenant-1',
            },
            {
                jobId: 'confirm:tx-1',
                attempts: 5,
                backoff: {
                    type: 'exponential',
                    delay: 5000,
                },
                removeOnComplete: true,
                removeOnFail: false,
            },
        );

        expect(transactionConfirmationQueue.add).toHaveBeenNthCalledWith(
            2,
            JOBS.CONFIRM_TRANSACTION,
            {
                transactionId: 'tx-2',
                tenantId: 'tenant-2',
            },
            {
                jobId: 'confirm:tx-2',
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

    it('should do nothing when there are no submitted transactions', async () => {
        repositoryMock.findSubmittedCandidates.mockResolvedValue([]);

        await processor.processSubmittedTransactions();

        expect(repositoryMock.findSubmittedCandidates).toHaveBeenCalledTimes(1);

        expect(transactionConfirmationQueue.add).not.toHaveBeenCalled();
    });

    it('should continue recovering remaining transactions when enqueue fails', async () => {
        repositoryMock.findSubmittedCandidates.mockResolvedValue([
            {
                id: 'tx-1',
                tenantId: 'tenant-1',
                txHash: '0xhash1',
                status: 'SUBMITTED',
            },
            {
                id: 'tx-2',
                tenantId: 'tenant-1',
                txHash: '0xhash2',
                status: 'SUBMITTED',
            },
        ]);

        vi.mocked(transactionConfirmationQueue.add)
            .mockRejectedValueOnce(new Error('Redis unavailable'))
            .mockResolvedValueOnce({} as never);

        await processor.processSubmittedTransactions();

        expect(transactionConfirmationQueue.add).toHaveBeenCalledTimes(2);

        expect(transactionConfirmationQueue.add).toHaveBeenNthCalledWith(
            2,
            JOBS.CONFIRM_TRANSACTION,
            {
                transactionId: 'tx-2',
                tenantId: 'tenant-1',
            },
            expect.objectContaining({
                jobId: 'confirm:tx-2',
            }),
        );
    });
});
