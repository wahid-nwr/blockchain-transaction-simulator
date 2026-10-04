import { describe, expect, it } from 'vitest';

import { getEvmChain, getEvmChainId, isEvmChainId } from '../../../src/blockchain/evm/chain.js';

const ROBINHOOD_TESTNET_CHAIN_ID = 46630;

describe('getEvmChainId', () => {
    it('defaults to the local Anvil chain when EVM_CHAIN_ID is unset or blank', () => {
        expect(getEvmChainId({})).toBe(31337);
        expect(getEvmChainId({ EVM_CHAIN_ID: '' })).toBe(31337);
        expect(getEvmChainId({ EVM_CHAIN_ID: '   ' })).toBe(31337);
    });

    it('reads a configured chain id', () => {
        expect(getEvmChainId({ EVM_CHAIN_ID: '46630' })).toBe(ROBINHOOD_TESTNET_CHAIN_ID);
        expect(getEvmChainId({ EVM_CHAIN_ID: ' 4663 ' })).toBe(4663);
    });

    it.each(['abc', '0', '-1', '1.5', '0x7a69', '1e3', '99999999999999999999'])(
        'rejects the malformed value %s',
        (value) => {
            expect(() => getEvmChainId({ EVM_CHAIN_ID: value })).toThrow(/Invalid EVM_CHAIN_ID/);
        },
    );

    it('rejects chain ids that collide with the Bitcoin and Solana sentinels', () => {
        expect(() => getEvmChainId({ EVM_CHAIN_ID: '18444' })).toThrow(/reserved non-EVM/);
        expect(() => getEvmChainId({ EVM_CHAIN_ID: '900' })).toThrow(/reserved non-EVM/);
    });
});

describe('getEvmChain', () => {
    it('returns viem’s Anvil definition by default', () => {
        const chain = getEvmChain({});

        expect(chain.id).toBe(31337);
    });

    it('returns viem’s Robinhood Chain testnet definition for 46630', () => {
        const chain = getEvmChain({ EVM_CHAIN_ID: '46630' });

        expect(chain.id).toBe(ROBINHOOD_TESTNET_CHAIN_ID);
        expect(chain.name).toBe('Robinhood Chain Testnet');
        expect(chain.testnet).toBe(true);
    });

    it('builds a generic definition for a chain viem has no entry for', () => {
        const chain = getEvmChain({
            EVM_CHAIN_ID: '424242',
            RPC_URL: 'https://rpc.example.test',
        });

        expect(chain.id).toBe(424242);
        expect(chain.nativeCurrency.decimals).toBe(18);
        expect(chain.rpcUrls.default.http).toEqual(['https://rpc.example.test']);
    });

    it('propagates validation errors so a bad config fails at startup', () => {
        expect(() => getEvmChain({ EVM_CHAIN_ID: 'nope' })).toThrow(/Invalid EVM_CHAIN_ID/);
    });
});

describe('isEvmChainId', () => {
    it('matches only the configured EVM chain', () => {
        expect(isEvmChainId(31337, {})).toBe(true);
        expect(isEvmChainId(46630, {})).toBe(false);

        const testnet = { EVM_CHAIN_ID: '46630' };
        expect(isEvmChainId(46630, testnet)).toBe(true);
        expect(isEvmChainId(31337, testnet)).toBe(false);
    });
});
