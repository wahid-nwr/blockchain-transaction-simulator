import type { Blockchain } from '@prisma/client';

import { TokenRepository } from '../repositories/token.repository.js';
import { Errors } from '../common/errors/errors.js';
import { requireContractAddress } from './token-contract-address.js';
import { blockchainAdapterRegistry } from '../blockchain/blockchain-adapters.js';
import type { BlockchainAdapterRegistry } from '../blockchain/blockchain-adapter.registry.js';

export class TokenService {
    constructor(
        private readonly repository: TokenRepository,
        private readonly blockchainRegistry: BlockchainAdapterRegistry = blockchainAdapterRegistry,
    ) {}

    async registerToken(data: {
        name: string;
        symbol: string;
        contractAddress: string;
        decimals: number;
        blockchain: Blockchain;
    }) {
        const adapter = this.blockchainRegistry.get(data.blockchain);

        if (!adapter.validateAssetIdentifier(data.contractAddress)) {
            throw Errors.invalidAssetIdentifier(data.blockchain, data.contractAddress);
        }

        const exists = await this.repository.exists(data.contractAddress, data.blockchain);
        if (exists) {
            throw new Error('Token already registered');
        }
        return this.repository.create(data);
    }

    async getTokens() {
        return this.repository.findAll();
    }

    async getToken(id: string) {
        const token = await this.repository.findById(id);
        if (!token) {
            throw Errors.tokenNotFound(id);
        }
        return token;
    }

    async mintToken(tokenId: string, receiver: string, amount: bigint) {
        const token = await this.getToken(tokenId);
        const adapter = this.blockchainRegistry.get(token.blockchain);

        if (!adapter.mint) {
            throw Errors.unsupportedChainCapability('mint', token.blockchain);
        }

        const result = await adapter.mint({
            assetIdentifier: requireContractAddress(token.contractAddress),
            toAddress: receiver,
            amount,
        });

        return { transactionHash: result.txHash };
    }
}
