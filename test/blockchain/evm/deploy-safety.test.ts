import { describe, expect, it } from 'vitest';
import { generatePrivateKey, mnemonicToAccount, privateKeyToAccount } from 'viem/accounts';

import {
    DeploySafetyError,
    assertDeployAllowed,
    describeRpcError,
    isLocalChain,
    isWellKnownDevAccount,
    parseDeployerKey,
    redactRpcUrl,
    redactUrlsInText,
} from '../../../src/blockchain/evm/deploy-safety.js';

const MNEMONIC = 'test test test test test test test test test test test junk';
const ROBINHOOD_TESTNET = 46630;
const freshAddress = () => privateKeyToAccount(generatePrivateKey()).address;

describe('isWellKnownDevAccount', () => {
    it('recognises the Anvil/Hardhat default accounts, in any address casing', () => {
        const first = mnemonicToAccount(MNEMONIC, { addressIndex: 0 }).address;

        expect(first).toBe('0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266');
        expect(isWellKnownDevAccount(first)).toBe(true);
        expect(isWellKnownDevAccount(first.toLowerCase())).toBe(true);
        expect(isWellKnownDevAccount(first.toUpperCase().replace('0X', '0x'))).toBe(true);
    });

    it('covers all 20 Hardhat default accounts, and not the 21st', () => {
        for (let addressIndex = 0; addressIndex < 20; addressIndex++) {
            expect(
                isWellKnownDevAccount(mnemonicToAccount(MNEMONIC, { addressIndex }).address),
            ).toBe(true);
        }

        expect(
            isWellKnownDevAccount(mnemonicToAccount(MNEMONIC, { addressIndex: 20 }).address),
        ).toBe(false);
    });

    it('does not flag a freshly generated account', () => {
        expect(isWellKnownDevAccount(freshAddress())).toBe(false);
    });
});

describe('parseDeployerKey', () => {
    const key = generatePrivateKey();

    it('accepts a 0x-prefixed key, and adds the prefix when missing', () => {
        expect(parseDeployerKey(key)).toBe(key);
        expect(parseDeployerKey(key.slice(2))).toBe(key);
        expect(parseDeployerKey(`  ${key}\n`)).toBe(key);
    });

    it.each([undefined, '', '   '])('rejects a missing key (%j)', (value) => {
        expect(() => parseDeployerKey(value)).toThrow(/PRIVATE_KEY is not set/);
    });

    it.each(['0x1234', 'not-a-key', `0x${'g'.repeat(64)}`, `0x${'a'.repeat(63)}`])(
        'rejects a malformed key without echoing it',
        (value) => {
            try {
                parseDeployerKey(value);
                expect.unreachable();
            } catch (error) {
                expect(error).toBeInstanceOf(DeploySafetyError);
                expect((error as Error).message).toBe(
                    'PRIVATE_KEY is not a 32-byte hex private key',
                );
                expect((error as Error).message).not.toContain(value);
            }
        },
    );
});

describe('redactRpcUrl', () => {
    it('keeps only the origin, dropping API keys in the path and query', () => {
        expect(redactRpcUrl('https://rpc.example.com/v2/SECRET-API-KEY')).toBe(
            'https://rpc.example.com',
        );
        expect(redactRpcUrl('https://rpc.example.com:8443/?apikey=SECRET')).toBe(
            'https://rpc.example.com:8443',
        );
        expect(redactRpcUrl('https://user:pass@rpc.example.com/x')).toBe('https://rpc.example.com');
    });

    it('does not leak anything from an unparseable value', () => {
        expect(redactRpcUrl('not a url SECRET')).toBe('<invalid RPC_URL>');
    });
});

describe('redactUrlsInText', () => {
    it('reduces every URL in a message to its origin', () => {
        expect(
            redactUrlsInText(
                'failed: https://rpc.example.com/v2/SECRET and http://127.0.0.1:8545/x?k=SECRET.',
            ),
        ).toBe('failed: https://rpc.example.com and http://127.0.0.1:8545.');
    });

    it('leaves text without URLs alone', () => {
        expect(redactUrlsInText('nonce too low')).toBe('nonce too low');
    });
});

describe('describeRpcError', () => {
    it('uses the short message and details, redacted, never the URL-bearing full message', () => {
        const error = Object.assign(
            new Error(
                'HTTP request failed.\n\nURL: https://rpc.example.com/v2/SECRET\nRequest body: {"data":"0x6080..."}',
            ),
            {
                shortMessage: 'HTTP request failed.',
                details: '404 from https://rpc.example.com/v2/SECRET',
            },
        );

        const text = describeRpcError(error);

        expect(text).toBe('HTTP request failed.: 404 from https://rpc.example.com');
        expect(text).not.toContain('SECRET');
        expect(text).not.toContain('Request body');
    });

    it('falls back to the first line of a plain error, redacted', () => {
        expect(describeRpcError(new Error('connect ECONNREFUSED https://x.io/KEY\nstack...'))).toBe(
            'connect ECONNREFUSED https://x.io',
        );
    });

    it('handles non-error values and caps the length', () => {
        expect(describeRpcError('boom')).toBe('boom');
        expect(describeRpcError(new Error('x'.repeat(1000))).length).toBe(300);
    });
});

describe('isLocalChain', () => {
    it('is true only for the Anvil chain id', () => {
        expect(isLocalChain(31337)).toBe(true);
        expect(isLocalChain(ROBINHOOD_TESTNET)).toBe(false);
    });
});

describe('assertDeployAllowed', () => {
    const ok = {
        configuredChainId: ROBINHOOD_TESTNET,
        rpcChainId: ROBINHOOD_TESTNET,
        deployerAddress: freshAddress(),
        balance: 10n ** 18n,
        estimatedCost: 10n ** 15n,
    };

    it('allows a funded fresh key on the configured network', () => {
        expect(() => assertDeployAllowed(ok)).not.toThrow();
    });

    it('refuses when the RPC serves a different chain than configured, before any other check', () => {
        // Also a dev key and zero balance: the network mismatch must be reported first.
        expect(() =>
            assertDeployAllowed({
                ...ok,
                rpcChainId: 1,
                deployerAddress: mnemonicToAccount(MNEMONIC).address,
                balance: 0n,
            }),
        ).toThrow(/serves chain 1 but EVM_CHAIN_ID is 46630/);
    });

    it('refuses a well-known dev key on a live chain', () => {
        expect(() =>
            assertDeployAllowed({ ...ok, deployerAddress: mnemonicToAccount(MNEMONIC).address }),
        ).toThrow(/well-known development account/);
    });

    it('allows a dev key on the local chain, where it is the point', () => {
        expect(() =>
            assertDeployAllowed({
                ...ok,
                configuredChainId: 31337,
                rpcChainId: 31337,
                deployerAddress: mnemonicToAccount(MNEMONIC).address,
            }),
        ).not.toThrow();
    });

    it('refuses an unfunded deployer, naming the address to fund', () => {
        expect(() => assertDeployAllowed({ ...ok, balance: 0n })).toThrow(
            new RegExp(`${ok.deployerAddress} has no funds`),
        );
    });

    it('refuses a deployer that cannot cover the estimated cost', () => {
        expect(() => assertDeployAllowed({ ...ok, balance: 100n, estimatedCost: 101n })).toThrow(
            /estimated to cost/,
        );
    });

    it('allows a balance exactly equal to the estimated cost', () => {
        expect(() =>
            assertDeployAllowed({ ...ok, balance: 500n, estimatedCost: 500n }),
        ).not.toThrow();
    });
});
