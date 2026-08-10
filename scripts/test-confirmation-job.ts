import { transactionConfirmationQueue } from '../src/queues/index.js';

await transactionConfirmationQueue.add('confirm', {
    tenantId: 'tenant-1', transactionId: 'existing-id',
});

process.exit(0);
