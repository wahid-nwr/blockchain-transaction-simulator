import { transactionConfirmationQueue } from '../src/queues/index.js';
import { JOBS } from '../src/queues/job.constants.js';

await transactionConfirmationQueue.add(JOBS.CONFIRM_TRANSACTION, {
    tenantId: 'tenant-1', transactionId: 'existing-id',
});

process.exit(0);
