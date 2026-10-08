import { describe, expect, it } from 'vitest';

import {
    DEFAULT_MAX_BLOCK_RANGE,
    DEFAULT_MAX_WINDOWS_PER_RUN,
    loadEvmIndexerConfig,
} from '../../../src/blockchain/evm/indexer-config.js';

describe('loadEvmIndexerConfig', () => {
    it('defaults to the local-node behaviour: genesis start, no confirmation lag, bounded windows', () => {
        expect(loadEvmIndexerConfig({})).toEqual({
            startBlock: 0n,
            confirmations: 0n,
            maxBlockRange: DEFAULT_MAX_BLOCK_RANGE,
            maxWindowsPerRun: DEFAULT_MAX_WINDOWS_PER_RUN,
        });
    });

    it('treats blank values as unset', () => {
        expect(
            loadEvmIndexerConfig({
                EVM_INDEX_START_BLOCK: '  ',
                EVM_INDEX_CONFIRMATIONS: '',
            }),
        ).toMatchObject({ startBlock: 0n, confirmations: 0n });
    });

    it('reads configured values', () => {
        expect(
            loadEvmIndexerConfig({
                EVM_INDEX_START_BLOCK: '1234567',
                EVM_INDEX_CONFIRMATIONS: '20',
                EVM_LOGS_MAX_BLOCK_RANGE: '500',
                EVM_INDEX_MAX_WINDOWS_PER_RUN: '5',
            }),
        ).toEqual({
            startBlock: 1234567n,
            confirmations: 20n,
            maxBlockRange: 500n,
            maxWindowsPerRun: 5,
        });
    });

    it('handles block numbers beyond Number.MAX_SAFE_INTEGER exactly', () => {
        expect(loadEvmIndexerConfig({ EVM_INDEX_START_BLOCK: '9007199254740993' }).startBlock).toBe(
            9007199254740993n,
        );
    });

    it.each([
        ['EVM_INDEX_START_BLOCK', '-1'],
        ['EVM_INDEX_START_BLOCK', 'abc'],
        ['EVM_INDEX_START_BLOCK', '1.5'],
        ['EVM_INDEX_START_BLOCK', '0x10'],
        ['EVM_INDEX_CONFIRMATIONS', '-3'],
        ['EVM_LOGS_MAX_BLOCK_RANGE', '0'],
        ['EVM_LOGS_MAX_BLOCK_RANGE', 'big'],
        ['EVM_INDEX_MAX_WINDOWS_PER_RUN', '0'],
    ])('rejects %s=%s at startup instead of falling back to a default', (name, value) => {
        expect(() => loadEvmIndexerConfig({ [name]: value })).toThrow(
            new RegExp(`Invalid ${name}`),
        );
    });
});
