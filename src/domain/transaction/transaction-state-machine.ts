import { TransactionStatus } from '@prisma/client';

const ALLOWED_TRANSITIONS: Readonly<Record<TransactionStatus, readonly TransactionStatus[]>> = {
    [TransactionStatus.PENDING]: [TransactionStatus.SUBMITTED, TransactionStatus.FAILED],

    [TransactionStatus.SUBMITTED]: [TransactionStatus.CONFIRMING, TransactionStatus.EXPIRED],

    [TransactionStatus.CONFIRMING]: [
        TransactionStatus.CONFIRMED,
        TransactionStatus.FAILED,
        TransactionStatus.EXPIRED,
    ],

    [TransactionStatus.CONFIRMED]: [],

    [TransactionStatus.FAILED]: [],

    [TransactionStatus.EXPIRED]: [],
};

export class InvalidTransactionTransitionError extends Error {
    constructor(
        public readonly from: TransactionStatus,
        public readonly to: TransactionStatus,
    ) {
        super(`Invalid transaction state transition: ${from} -> ${to}`);

        this.name = 'InvalidTransactionTransitionError';
    }
}

export class TransactionStateMachine {
    static canTransition(from: TransactionStatus, to: TransactionStatus): boolean {
        return ALLOWED_TRANSITIONS[from].includes(to);
    }

    static assertTransition(from: TransactionStatus, to: TransactionStatus): void {
        if (!this.canTransition(from, to)) {
            throw new InvalidTransactionTransitionError(from, to);
        }
    }

    static getAllowedTransitions(from: TransactionStatus): readonly TransactionStatus[] {
        return ALLOWED_TRANSITIONS[from];
    }

    static canExpire(status: TransactionStatus): boolean {
        return status === TransactionStatus.SUBMITTED || status === TransactionStatus.CONFIRMING;
    }
}
