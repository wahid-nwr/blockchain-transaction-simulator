import { TokenRepository } from "../repositories/token.repository.js";

export class TokenService {
    constructor(
        private readonly repository: TokenRepository
    ) {}

    async registerToken(data: {
        name: string;
        symbol: string;
        contractAddress: string;
        decimals: number;
    }) {
        const exists = await this.repository.exists(data.contractAddress);
        if (exists) {
            throw new Error("Token already registered");
        }
        return this.repository.create(data);
    }
}