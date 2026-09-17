import { describe, expect, it } from 'vitest';

import type { BlockchainTransaction } from '../../src/blockchain/blockchain-adapter.js';
import { BlockchainAdapterRegistry } from '../../src/blockchain/blockchain-adapter.registry.js';

function adapter(chain: string) {
    return {
        chain,
        submitTransfer: async () => ({ txHash: 'tx' }),
        getTransaction: async (): Promise<BlockchainTransaction> => ({
            txHash: '0x123',
            blockNumber: null,
            confirmations: 0,
            status: 'pending',
            gasUsed: null,
        }),
    };
}

describe('BlockchainAdapterRegistry', () => {
    it('resolves an adapter case-insensitively', () => {
        const registry = new BlockchainAdapterRegistry([adapter('EVM'), adapter('BITCOIN')]);

        expect(registry.get('EVM').chain).toBe('EVM');
        expect(registry.get('evm').chain).toBe('EVM');

        expect(registry.get('BITCOIN').chain).toBe('BITCOIN');
        expect(registry.get('bitcoin').chain).toBe('BITCOIN');
    });

    it('throws when no adapter exists', () => {
        const registry = new BlockchainAdapterRegistry([adapter('EVM')]);

        expect(() => registry.get('BITCOIN')).toThrow(
            'No blockchain adapter registered for chain: BITCOIN',
        );
    });
});
