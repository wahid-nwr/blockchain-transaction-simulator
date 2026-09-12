import { describe, expect, it } from 'vitest';

import { BlockchainAdapterRegistry } from '../../src/blockchain/blockchain-adapter.registry.js';

describe('BlockchainAdapterRegistry', () => {
    const evmAdapter = {
        chain: 'EVM',
        submitTransfer: async () => ({ txHash: 'evm-tx' }),
        getTransaction: async () => ({
            txHash: 'evm-tx',
            blockNumber: 1n,
            confirmations: 1,
            success: true,
            gasUsed: 21_000n,
        }),
    };

    it('should resolve adapters case-insensitively', () => {
        const registry = new BlockchainAdapterRegistry([evmAdapter]);

        expect(registry.get('EVM')).toBe(evmAdapter);
        expect(registry.get('evm')).toBe(evmAdapter);
    });

    it('should fail clearly when no adapter is registered', () => {
        const registry = new BlockchainAdapterRegistry([]);

        expect(() => registry.get('BITCOIN')).toThrow(
            'No blockchain adapter registered for chain: BITCOIN',
        );
    });
});
