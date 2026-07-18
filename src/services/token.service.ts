import { TokenRepository } from '../repositories/token.repository.js';
import { MintService } from './mint.service.js';

export class TokenService {
    constructor(
        private readonly repository: TokenRepository,
        private readonly mintService: MintService,
    ) {}

    async registerToken(data: {
        name: string;
        symbol: string;
        contractAddress: string;
        decimals: number;
    }) {
        const exists = await this.repository.exists(data.contractAddress);
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
            throw new Error('Token not found');
        }
        return token;
    }

    async mintToken(tokenId: string, receiver: string, amount: bigint) {
        const token = await this.repository.findById(tokenId);
        if (!token) {
            throw new Error('Token not found');
        }
        return this.mintService.mint(token.contractAddress, receiver, amount);
    }
}
