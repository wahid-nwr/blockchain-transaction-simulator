/**
 * Thrown when a blockchain adapter's getTransaction() reports a
 * transaction as 'pending' (found, but not yet in a terminal state).
 *
 * This is deliberately an error, not a return value the caller inspects,
 * so it flows through the same retry path as "receipt not found yet" for
 * EVM: ConfirmationProcessor.handleConfirmationError treats it as
 * retryable rather than as a confirmation failure, and the job's normal
 * BullMQ attempts/backoff (see src/queues/transaction.queue.ts) take it
 * from there. If a transaction never leaves 'pending', ExpirationProcessor
 * is the eventual backstop — see docs/transaction-lifecycle.md.
 */
export class TransactionPendingError extends Error {
    constructor(txHash: string) {
        super(`Transaction ${txHash} is still pending confirmation`);

        this.name = 'TransactionPendingError';
    }
}
