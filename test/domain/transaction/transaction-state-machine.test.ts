import { describe, expect, it } from 'vitest';
import { TransactionStatus } from '@prisma/client';

import {
    InvalidTransactionTransitionError,
    TransactionStateMachine,
} from '../../../src/domain/transaction/transaction-state-machine.js';

describe('TransactionStateMachine', () => {
    describe('valid transitions', () => {
        const validTransitions: Array<[TransactionStatus, TransactionStatus]> = [
            [TransactionStatus.PENDING, TransactionStatus.SUBMITTED],
            [TransactionStatus.SUBMITTED, TransactionStatus.CONFIRMING],
            [TransactionStatus.CONFIRMING, TransactionStatus.CONFIRMED],
            [TransactionStatus.CONFIRMING, TransactionStatus.FAILED],
            [TransactionStatus.CONFIRMING, TransactionStatus.EXPIRED],
        ];

        it.each(validTransitions)('allows %s -> %s', (from, to) => {
            expect(TransactionStateMachine.canTransition(from, to)).toBe(true);

            expect(() => TransactionStateMachine.assertTransition(from, to)).not.toThrow();
        });
    });

    describe('invalid transitions', () => {
        const invalidTransitions: Array<[TransactionStatus, TransactionStatus]> = [
            [TransactionStatus.PENDING, TransactionStatus.CONFIRMING],
            [TransactionStatus.PENDING, TransactionStatus.CONFIRMED],
            [TransactionStatus.PENDING, TransactionStatus.EXPIRED],

            [TransactionStatus.SUBMITTED, TransactionStatus.CONFIRMED],
            [TransactionStatus.SUBMITTED, TransactionStatus.FAILED],
            [TransactionStatus.SUBMITTED, TransactionStatus.EXPIRED],

            [TransactionStatus.CONFIRMED, TransactionStatus.PENDING],
            [TransactionStatus.CONFIRMED, TransactionStatus.SUBMITTED],
            [TransactionStatus.CONFIRMED, TransactionStatus.CONFIRMING],
            [TransactionStatus.CONFIRMED, TransactionStatus.FAILED],
            [TransactionStatus.CONFIRMED, TransactionStatus.EXPIRED],

            [TransactionStatus.FAILED, TransactionStatus.PENDING],
            [TransactionStatus.FAILED, TransactionStatus.SUBMITTED],
            [TransactionStatus.FAILED, TransactionStatus.CONFIRMING],
            [TransactionStatus.FAILED, TransactionStatus.CONFIRMED],
            [TransactionStatus.FAILED, TransactionStatus.EXPIRED],

            [TransactionStatus.EXPIRED, TransactionStatus.PENDING],
            [TransactionStatus.EXPIRED, TransactionStatus.SUBMITTED],
            [TransactionStatus.EXPIRED, TransactionStatus.CONFIRMING],
            [TransactionStatus.EXPIRED, TransactionStatus.CONFIRMED],
            [TransactionStatus.EXPIRED, TransactionStatus.FAILED],
        ];

        it.each(invalidTransitions)('rejects %s -> %s', (from, to) => {
            expect(TransactionStateMachine.canTransition(from, to)).toBe(false);

            expect(() => TransactionStateMachine.assertTransition(from, to)).toThrow(
                InvalidTransactionTransitionError,
            );
        });
    });

    describe('terminal states', () => {
        it.each([TransactionStatus.CONFIRMED, TransactionStatus.FAILED, TransactionStatus.EXPIRED])(
            '%s has no outgoing transitions',
            (status) => {
                expect(TransactionStateMachine.getAllowedTransitions(status)).toEqual([]);
            },
        );
    });

    describe('error details', () => {
        it('includes the source and target states', () => {
            expect(() =>
                TransactionStateMachine.assertTransition(
                    TransactionStatus.PENDING,
                    TransactionStatus.CONFIRMED,
                ),
            ).toThrow('Invalid transaction state transition: PENDING -> CONFIRMED');
        });
    });
});
