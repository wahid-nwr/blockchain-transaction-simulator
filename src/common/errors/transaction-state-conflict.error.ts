import { TransactionStatus } from '@prisma/client';

export class TransactionStateConflictError extends Error {
    constructor(
        public readonly transactionId: string,
        public readonly expectedStatus: TransactionStatus,
    ) {
        super(`Transaction ${transactionId} is no longer in ${expectedStatus} state`);

        this.name = 'TransactionStateConflictError';
    }
}
