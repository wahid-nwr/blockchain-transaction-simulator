import { describe, it, expect } from 'vitest';
import {
    encryptWalletKey,
    decryptWalletKey,
    parseLocalMasterKey,
} from '../../src/crypto/envelope.js';

// These rely on the ambient KMS_PROVIDER=local / LOCAL_KMS_MASTER_KEY already
// set in .env.test for the whole suite — nothing here mutates process.env,
// so there's no way this file can leak state into any other test file
// (including via Vitest's cross-file async interleaving under singleFork).
describe('envelope (local provider)', () => {
    it('round-trips a private key through encrypt/decrypt', async () => {
        const privateKey =
            '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const;

        const ciphertext = await encryptWalletKey(privateKey, 'test-key');
        expect(Buffer.isBuffer(ciphertext)).toBe(true);

        const plaintext = await decryptWalletKey(ciphertext, 'test-key');
        expect(plaintext).toBe(privateKey);
    });

    it('produces different ciphertext for the same key on repeated calls (random IV)', async () => {
        const privateKey =
            '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const;

        const first = await encryptWalletKey(privateKey, 'test-key');
        const second = await encryptWalletKey(privateKey, 'test-key');

        expect(Buffer.compare(first, second)).not.toBe(0);
    });

    it('fails to decrypt if the ciphertext has been tampered with', async () => {
        const privateKey =
            '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const;

        const ciphertext = await encryptWalletKey(privateKey, 'test-key');
        ciphertext[ciphertext.length - 1] ^= 0xff; // flip a byte in the ciphertext

        await expect(decryptWalletKey(ciphertext, 'test-key')).rejects.toThrow();
    });
});

// Pure-function tests for the validation logic itself — explicit inputs only,
// no environment involved, so these can never interfere with anything else.
describe('parseLocalMasterKey', () => {
    it('throws when the key is missing', () => {
        expect(() => parseLocalMasterKey(undefined)).toThrow('LOCAL_KMS_MASTER_KEY is not set');
        expect(() => parseLocalMasterKey('')).toThrow('LOCAL_KMS_MASTER_KEY is not set');
    });

    it('throws when the key is the wrong length', () => {
        expect(() => parseLocalMasterKey('abcd')).toThrow('64 hex characters');
    });

    it('throws when the key contains non-hex characters', () => {
        const notHex = 'zz'.repeat(32);
        expect(() => parseLocalMasterKey(notHex)).toThrow('64 hex characters');
    });

    it('accepts a valid 64-char hex key', () => {
        const valid = '01'.repeat(32);
        expect(() => parseLocalMasterKey(valid)).not.toThrow();
    });
});
