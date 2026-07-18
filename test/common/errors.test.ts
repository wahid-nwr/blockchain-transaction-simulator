import { describe, it, expect } from 'vitest';
import { Errors } from '../../src/common/errors/errors.js';

describe('Error Factory', () => {
    it('creates wallet not found error', () => {
        const error = Errors.walletNotFound('wallet-123');

        expect(error.statusCode).toBe(404);

        expect(error.code).toBe('WALLET_NOT_FOUND');

        expect(error.message).toBe('Wallet not found');

        expect(error.details).toEqual({
            walletId: 'wallet-123',
        });
    });

    it('creates blockchain error', () => {
        const error = Errors.blockchainError('Transfer failed');

        expect(error.statusCode).toBe(502);

        expect(error.code).toBe('BLOCKCHAIN_ERROR');
    });
});
