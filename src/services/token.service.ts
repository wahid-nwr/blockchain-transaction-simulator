import { TokenRepository } from '../repositories/token.repository.js';
import { MintService } from './mint.service.js';
import { Errors } from '../common/errors/errors.js';
import { Signer } from '../blockchain/signer.js';

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
            throw Errors.tokenNotFound(id);
        }
        return token;
    }

    async mintToken(tokenId: string, receiver: string, amount: bigint, signer: Signer) {
        const token = await this.getToken(tokenId);

        return this.mintService.mint(token.contractAddress, receiver, amount, signer.privateKey);
    }
}
