import { transactionConfirmationQueue } from '../queues/index.js';
import { JOBS } from '../queues/job.constants.js';
import { TransactionRepository } from '../repositories/transaction.repository.js';
import { getLogger } from '../observability/logger.js';

export class SubmissionRecoveryProcessor {
    private static readonly NAME = 'submission-recovery-processor';

    constructor(private readonly repository: TransactionRepository) {}

    async processSubmittedTransactions() {
        const transactions = await this.repository.findSubmittedCandidates();

        for (const transaction of transactions) {
            try {
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
                        processor: SubmissionRecoveryProcessor.NAME,
                        transactionId: transaction.id,
                        tenantId: transaction.tenantId,
                    },
                    'transaction.submission.recovery.enqueued',
                );
            } catch (error) {
                getLogger().error(
                    {
                        processor: SubmissionRecoveryProcessor.NAME,
                        transactionId: transaction.id,
                        tenantId: transaction.tenantId,
                        error: error instanceof Error ? error.message : String(error),
                    },
                    'transaction.submission.recovery.failed',
                );
            }
        }
    }
}
