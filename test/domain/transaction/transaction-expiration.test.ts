import { describe, expect, it } from 'vitest';

import {
    isTransactionExpired,
    getTransactionExpirationTime,
} from '../../../src/domain/transaction/transaction-expiration.js';

describe('Transaction expiration', () => {
    const submittedAt = new Date('2026-08-12T10:00:00.000Z');

    const timeoutMs = 15 * 60 * 1000;

    it('should not expire before timeout', () => {
        const now = new Date('2026-08-12T10:14:59.999Z');

        expect(isTransactionExpired(submittedAt, now, timeoutMs)).toBe(false);
    });

    it('should expire exactly at timeout', () => {
        const now = new Date('2026-08-12T10:15:00.000Z');

        expect(isTransactionExpired(submittedAt, now, timeoutMs)).toBe(true);
    });

    it('should expire after timeout', () => {
        const now = new Date('2026-08-12T10:20:00.000Z');

        expect(isTransactionExpired(submittedAt, now, timeoutMs)).toBe(true);
    });

    it('should calculate expiration deadline', () => {
        const deadline = getTransactionExpirationTime(submittedAt, timeoutMs);

        expect(deadline).toEqual(new Date('2026-08-12T10:15:00.000Z'));
    });
});
