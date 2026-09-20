import { describe, it, expect } from 'vitest';

import {
    ANVIL_CHAIN_ID,
    BITCOIN_REGTEST_CHAIN_ID,
    SOLANA_LOCALNET_CHAIN_ID,
    isCaseInsensitiveWalletAddress,
    isValidWalletAddress,
    normalizeWalletAddress,
} from '../../src/blockchain/wallet-address.js';

describe('isValidWalletAddress', () => {
    it('accepts a valid EVM address', () => {
        expect(
            isValidWalletAddress(ANVIL_CHAIN_ID, '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'),
        ).toBe(true);
    });

    it('rejects an invalid EVM address', () => {
        expect(isValidWalletAddress(ANVIL_CHAIN_ID, 'not-an-address')).toBe(false);
    });

    it('accepts a valid Bitcoin regtest bech32 address', () => {
        expect(
            isValidWalletAddress(
                BITCOIN_REGTEST_CHAIN_ID,
                'bcrt1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080',
            ),
        ).toBe(true);
    });

    it('accepts a valid Bitcoin regtest legacy base58 address', () => {
        expect(
            isValidWalletAddress(BITCOIN_REGTEST_CHAIN_ID, 'mfWxJ45yp2SFn7UciZyNpvDKrzbhyfKrY8'),
        ).toBe(true);
    });

    it('rejects an EVM address on the Bitcoin chain id', () => {
        expect(
            isValidWalletAddress(
                BITCOIN_REGTEST_CHAIN_ID,
                '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
            ),
        ).toBe(false);
    });

    it('accepts a valid Solana address', () => {
        expect(
            isValidWalletAddress(
                SOLANA_LOCALNET_CHAIN_ID,
                'ASHEhX8XkjBJuh5r6emuMALNWUbwtmooZUFZGNzd7dH5',
            ),
        ).toBe(true);
    });

    it('rejects a non-base58 string on the Solana chain id', () => {
        expect(isValidWalletAddress(SOLANA_LOCALNET_CHAIN_ID, 'not-base58-!!!')).toBe(false);
    });

    it('rejects a Bitcoin address on the Solana chain id', () => {
        expect(
            isValidWalletAddress(SOLANA_LOCALNET_CHAIN_ID, 'mfWxJ45yp2SFn7UciZyNpvDKrzbhyfKrY8'),
        ).toBe(false);
    });

    it('rejects an unrecognized chain id', () => {
        expect(isValidWalletAddress(999999, 'anything')).toBe(false);
    });

    it('rejects an empty address for every recognized chain', () => {
        expect(isValidWalletAddress(ANVIL_CHAIN_ID, '')).toBe(false);
        expect(isValidWalletAddress(BITCOIN_REGTEST_CHAIN_ID, '')).toBe(false);
        expect(isValidWalletAddress(SOLANA_LOCALNET_CHAIN_ID, '')).toBe(false);
    });
});

describe('isCaseInsensitiveWalletAddress / normalizeWalletAddress', () => {
    it('treats EVM addresses as case-insensitive and lowercases them', () => {
        const mixedCase = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';

        expect(isCaseInsensitiveWalletAddress(ANVIL_CHAIN_ID, mixedCase)).toBe(true);
        expect(normalizeWalletAddress(ANVIL_CHAIN_ID, mixedCase)).toBe(mixedCase.toLowerCase());
    });

    it('treats Bitcoin bech32 addresses as case-insensitive and lowercases them', () => {
        const address = 'BCRT1QW508D6QEJXTDG4Y5R3ZARVARY0C5XW7KYGT080';

        expect(isCaseInsensitiveWalletAddress(BITCOIN_REGTEST_CHAIN_ID, address)).toBe(true);
        expect(normalizeWalletAddress(BITCOIN_REGTEST_CHAIN_ID, address)).toBe(
            address.toLowerCase(),
        );
    });

    it('treats Bitcoin legacy base58 addresses as case-sensitive and preserves them exactly', () => {
        // A real regression: this address's case carries meaning. Lowercasing
        // it silently produces a different, wrong address rather than an
        // equivalent one — unlike bech32 or EVM hex, base58 has no
        // case-insensitive canonical form.
        const address = 'mfWxJ45yp2SFn7UciZyNpvDKrzbhyfKrY8';

        expect(isCaseInsensitiveWalletAddress(BITCOIN_REGTEST_CHAIN_ID, address)).toBe(false);
        expect(normalizeWalletAddress(BITCOIN_REGTEST_CHAIN_ID, address)).toBe(address);
    });

    it('treats Solana addresses as case-sensitive and preserves them exactly', () => {
        const address = 'ASHEhX8XkjBJuh5r6emuMALNWUbwtmooZUFZGNzd7dH5';

        expect(isCaseInsensitiveWalletAddress(SOLANA_LOCALNET_CHAIN_ID, address)).toBe(false);
        expect(normalizeWalletAddress(SOLANA_LOCALNET_CHAIN_ID, address)).toBe(address);
    });
});
