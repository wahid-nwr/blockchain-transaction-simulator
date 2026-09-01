import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PendingRecoveryProcessor } from '../../src/workers/pending-recovery.processor.js';
import { TransactionRepository } from '../../src/repositories/transaction.repository.js';
import { TransferRepository } from '../../src/repositories/transfer.repository.js';
import { TokenEventCursorRepository } from '../../src/repositories/token-event-cursor.repository.js';
import { transactionConfirmationQueue } from '../../src/queues/index.js';

vi.mock('../../src/queues/index.js', () => ({
    transactionConfirmationQueue: {
        add: vi.fn(),
    },
}));

vi.mock('../../src/observability/logger.js', () => ({
    getLogger: vi.fn(() => ({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    })),
}));

const GRACE_MS = 120_000;
const FAIL_AFTER_MS = 15 * 60_000;
const LISTENER_STALENESS_MS = 60_000;

function makeOrphanedTransaction(overrides: Record<string, unknown> = {}) {
    return {
        id: 'tx-1',
        tenantId: 'tenant-1',
        tokenId: 'token-1',
        amount: 100n,
        createdAt: new Date(Date.now() - 20 * 60_000), // comfortably past both thresholds by default
        fromWallet: { address: '0xFrom' },
        toWallet: { address: '0xTo' },
        ...overrides,
    };
}

describe('PendingRecoveryProcessor', () => {
    const transactionRepositoryMock = {
        findOrphanedPendingCandidates: vi.fn(),
        markSubmitted: vi.fn(),
        markFailed: vi.fn(),
    };

    const transferRepositoryMock = {
        findMatchingTransfer: vi.fn(),
    };

    const tokenEventCursorRepositoryMock = {
        findByTokenId: vi.fn(),
    };

    let processor: PendingRecoveryProcessor;

    beforeEach(() => {
        vi.clearAllMocks();

        processor = new PendingRecoveryProcessor(
            transactionRepositoryMock as unknown as TransactionRepository,
            transferRepositoryMock as unknown as TransferRepository,
            tokenEventCursorRepositoryMock as unknown as TokenEventCursorRepository,
            GRACE_MS,
            FAIL_AFTER_MS,
            LISTENER_STALENESS_MS,
        );
    });

    it('adopts a transaction when a matching on-chain transfer is found', async () => {
        const transaction = makeOrphanedTransaction();

        transactionRepositoryMock.findOrphanedPendingCandidates.mockResolvedValue([transaction]);
        transferRepositoryMock.findMatchingTransfer.mockResolvedValue({
            transactionHash: '0xADOPTED',
        });
        transactionRepositoryMock.markSubmitted.mockResolvedValue(undefined);
        vi.mocked(transactionConfirmationQueue.add).mockResolvedValue({} as never);

        await processor.processOrphanedPending();

        expect(transferRepositoryMock.findMatchingTransfer).toHaveBeenCalledWith({
            tokenId: transaction.tokenId,
            from: transaction.fromWallet.address,
            to: transaction.toWallet.address,
            amount: transaction.amount,
            notBefore: transaction.createdAt,
        });

        expect(transactionRepositoryMock.markSubmitted).toHaveBeenCalledWith('tx-1', '0xADOPTED');
        expect(transactionConfirmationQueue.add).toHaveBeenCalledTimes(1);
        expect(transactionRepositoryMock.markFailed).not.toHaveBeenCalled();
    });

    it('does nothing when no match is found and the transaction has not cleared failAfterMs yet', async () => {
        const transaction = makeOrphanedTransaction({
            createdAt: new Date(Date.now() - 5 * 60_000), // past grace, well short of failAfterMs
        });

        transactionRepositoryMock.findOrphanedPendingCandidates.mockResolvedValue([transaction]);
        transferRepositoryMock.findMatchingTransfer.mockResolvedValue(null);

        await processor.processOrphanedPending();

        expect(transactionRepositoryMock.markSubmitted).not.toHaveBeenCalled();
        expect(transactionRepositoryMock.markFailed).not.toHaveBeenCalled();
        // Should not even need to check listener health if it's too soon to act.
        expect(tokenEventCursorRepositoryMock.findByTokenId).not.toHaveBeenCalled();
    });

    it('defers (does not mark failed) when no match is found but the event listener is stale', async () => {
        const transaction = makeOrphanedTransaction();

        transactionRepositoryMock.findOrphanedPendingCandidates.mockResolvedValue([transaction]);
        transferRepositoryMock.findMatchingTransfer.mockResolvedValue(null);
        tokenEventCursorRepositoryMock.findByTokenId.mockResolvedValue({
            lastSuccessfulSync: new Date(Date.now() - 10 * 60_000), // stale relative to LISTENER_STALENESS_MS
        });

        await processor.processOrphanedPending();

        expect(transactionRepositoryMock.markFailed).not.toHaveBeenCalled();
    });

    it('defers when the event listener has never successfully synced at all', async () => {
        const transaction = makeOrphanedTransaction();

        transactionRepositoryMock.findOrphanedPendingCandidates.mockResolvedValue([transaction]);
        transferRepositoryMock.findMatchingTransfer.mockResolvedValue(null);
        tokenEventCursorRepositoryMock.findByTokenId.mockResolvedValue({
            lastSuccessfulSync: null,
        });

        await processor.processOrphanedPending();

        expect(transactionRepositoryMock.markFailed).not.toHaveBeenCalled();
    });

    it('marks the transaction failed when no match is found and the listener is healthy', async () => {
        const transaction = makeOrphanedTransaction();

        transactionRepositoryMock.findOrphanedPendingCandidates.mockResolvedValue([transaction]);
        transferRepositoryMock.findMatchingTransfer.mockResolvedValue(null);
        tokenEventCursorRepositoryMock.findByTokenId.mockResolvedValue({
            lastSuccessfulSync: new Date(),
        });
        transactionRepositoryMock.markFailed.mockResolvedValue(undefined);

        await processor.processOrphanedPending();

        expect(transactionRepositoryMock.markFailed).toHaveBeenCalledWith(
            'tx-1',
            expect.stringContaining('Orphaned in PENDING'),
        );
        expect(transactionRepositoryMock.markSubmitted).not.toHaveBeenCalled();
    });

    it('continues processing remaining candidates when one throws', async () => {
        const failing = makeOrphanedTransaction({ id: 'tx-fail' });
        const healthy = makeOrphanedTransaction({ id: 'tx-ok' });

        transactionRepositoryMock.findOrphanedPendingCandidates.mockResolvedValue([
            failing,
            healthy,
        ]);
        transferRepositoryMock.findMatchingTransfer
            .mockRejectedValueOnce(new Error('db blip'))
            .mockResolvedValueOnce({ transactionHash: '0xOK' });
        transactionRepositoryMock.markSubmitted.mockResolvedValue(undefined);
        vi.mocked(transactionConfirmationQueue.add).mockResolvedValue({} as never);

        await processor.processOrphanedPending();

        expect(transactionRepositoryMock.markSubmitted).toHaveBeenCalledTimes(1);
        expect(transactionRepositoryMock.markSubmitted).toHaveBeenCalledWith('tx-ok', '0xOK');
    });
});
