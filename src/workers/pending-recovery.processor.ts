import { Transaction, Wallet } from '@prisma/client';

import { transactionConfirmationQueue } from '../queues/index.js';
import { JOBS } from '../queues/job.constants.js';
import { TransactionRepository } from '../repositories/transaction.repository.js';
import { TransferRepository } from '../repositories/transfer.repository.js';
import { TokenEventCursorRepository } from '../repositories/token-event-cursor.repository.js';
import { getLogger } from '../observability/logger.js';

type OrphanedTransaction = Transaction & {
    fromWallet: Wallet;
    toWallet: Wallet;
};

/**
 * Recovers transactions orphaned in PENDING — created, but the API request
 * that would have submitted them to chain never completed (most likely a
 * process crash; a normal thrown error is already caught by
 * `TransferService.transfer()` and correctly marks the transaction
 * FAILED, so PENDING rows surviving past the grace period are the
 * exception, not the normal case).
 *
 * See docs/runbooks/confirmation-worker-lag.md and
 * docs/decisions/005-idempotency-and-financial-correctness.md for the full
 * reasoning. Short version: submission (`writeContract`) happens *before*
 * the DB is updated to SUBMITTED, so a crash in that narrow window means a
 * transfer may have actually succeeded on-chain with nothing in our own
 * records pointing at it. Blindly marking these FAILED on a timer would
 * risk silently mismatching the ledger against on-chain reality — exactly
 * the failure mode this whole system exists to prevent. So this processor
 * does two things, in order, for each orphaned candidate:
 *
 *   1. Look for independent on-chain evidence (a TokenTransfer row written
 *      by the event listener, which observes the chain directly and isn't
 *      affected by the crashed request) that the transfer actually
 *      happened. If found: adopt it — transition PENDING -> SUBMITTED with
 *      the discovered hash and let the normal confirmation pipeline take
 *      it from there, same as any other submission.
 *   2. Only if no evidence turns up after a longer, separately-configured
 *      window (and only once the event listener itself is confirmed
 *      healthy — see below) — conclude the submission never happened and
 *      mark the transaction FAILED.
 *
 * The from/to/amount match in step 1 is a heuristic, not a guaranteed
 * identity match — see TransferRepository.findMatchingTransfer's own
 * documentation for the known limitation (indistinguishable concurrent
 * transfers of the same amount between the same two wallets).
 */
export class PendingRecoveryProcessor {
    private static readonly NAME = 'pending-recovery-processor';

    constructor(
        private readonly transactionRepository: TransactionRepository,
        private readonly transferRepository: TransferRepository,
        private readonly tokenEventCursorRepository: TokenEventCursorRepository,
        /** Minimum age before a PENDING transaction is even considered — protects an in-flight request from being mistaken for orphaned. */
        private readonly graceMs: number,
        /** Minimum age before "no matching transfer found" is trusted enough to mark FAILED. Must be comfortably longer than graceMs plus normal chain confirmation + event-indexing time. */
        private readonly failAfterMs: number,
        /** How stale the event listener's last successful sync can be before we refuse to trust a "no evidence found" result at all. */
        private readonly listenerStalenessMs: number,
    ) {}

    async processOrphanedPending(): Promise<void> {
        const orphanedBefore = new Date(Date.now() - this.graceMs);

        const candidates = (await this.transactionRepository.findOrphanedPendingCandidates(
            orphanedBefore,
        )) as OrphanedTransaction[];

        for (const transaction of candidates) {
            await this.recoverOne(transaction);
        }
    }

    private async recoverOne(transaction: OrphanedTransaction): Promise<void> {
        try {
            const match = await this.transferRepository.findMatchingTransfer({
                tokenId: transaction.tokenId,
                from: transaction.fromWallet.address,
                to: transaction.toWallet.address,
                amount: transaction.amount,
                notBefore: transaction.createdAt,
            });

            if (match) {
                await this.adopt(transaction, match.transactionHash);
                return;
            }

            const ageMs = Date.now() - transaction.createdAt.getTime();

            if (ageMs < this.failAfterMs) {
                // Too soon to conclude nothing happened — the transfer
                // (and the listener picking it up) may simply not have
                // happened yet. Leave it PENDING; re-checked next cycle.
                return;
            }

            const listenerHealthy = await this.isEventListenerHealthy(transaction.tokenId);

            if (!listenerHealthy) {
                // Can't trust "no evidence" while the thing that would
                // produce the evidence might itself be behind or down.
                // Defer rather than risk a false FAILED against a transfer
                // that actually succeeded on-chain.
                getLogger().warn(
                    {
                        processor: PendingRecoveryProcessor.NAME,
                        transactionId: transaction.id,
                        tenantId: transaction.tenantId,
                        tokenId: transaction.tokenId,
                    },
                    'transaction.pending.recovery.deferred.listener_stale',
                );

                return;
            }

            await this.fail(transaction);
        } catch (error) {
            getLogger().error(
                {
                    processor: PendingRecoveryProcessor.NAME,
                    transactionId: transaction.id,
                    tenantId: transaction.tenantId,
                    error: error instanceof Error ? error.message : String(error),
                },
                'transaction.pending.recovery.failed',
            );
        }
    }

    private async isEventListenerHealthy(tokenId: string): Promise<boolean> {
        const cursor = await this.tokenEventCursorRepository.findByTokenId(tokenId);

        if (!cursor?.lastSuccessfulSync) {
            return false;
        }

        return Date.now() - cursor.lastSuccessfulSync.getTime() <= this.listenerStalenessMs;
    }

    private async adopt(transaction: OrphanedTransaction, txHash: string): Promise<void> {
        await this.transactionRepository.markSubmitted(transaction.id, txHash);

        // Deterministic jobId so a recovery cycle that races the next one
        // (or a retry of this same cycle after a partial failure) can't
        // double-enqueue — BullMQ treats a duplicate jobId as a no-op, not
        // a second job. Mirrors SubmissionRecoveryProcessor.
        await transactionConfirmationQueue.add(
            JOBS.CONFIRM_TRANSACTION,
            {
                transactionId: transaction.id,
                tenantId: transaction.tenantId,
            },
            {
                jobId: `confirm-${transaction.id}`,
                attempts: 5,
                backoff: {
                    type: 'exponential',
                    delay: 5000,
                },
                removeOnComplete: true,
                removeOnFail: false,
            },
        );

        getLogger().info(
            {
                processor: PendingRecoveryProcessor.NAME,
                transactionId: transaction.id,
                tenantId: transaction.tenantId,
                txHash,
            },
            'transaction.pending.recovery.adopted',
        );
    }

    private async fail(transaction: OrphanedTransaction): Promise<void> {
        await this.transactionRepository.markFailed(
            transaction.id,
            'Orphaned in PENDING: no matching on-chain transfer found after the recovery window. Likely a process crash before submission completed.',
        );

        getLogger().warn(
            {
                processor: PendingRecoveryProcessor.NAME,
                transactionId: transaction.id,
                tenantId: transaction.tenantId,
            },
            'transaction.pending.recovery.failed_no_evidence',
        );
    }
}
