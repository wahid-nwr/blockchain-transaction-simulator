import type { BlockchainAdapter } from './blockchain-adapter.js';

export class BlockchainAdapterRegistry {
    constructor(private readonly adapters: BlockchainAdapter[]) {}

    get(chain: string): BlockchainAdapter {
        const adapter = this.adapters.find(
            (candidate) => candidate.chain === chain.toUpperCase(),
        );

        if (!adapter) {
            throw new Error(`No blockchain adapter registered for chain: ${chain}`);
        }

        return adapter;
    }
}
