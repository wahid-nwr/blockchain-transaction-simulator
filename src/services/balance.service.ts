import { BalanceRepository } from "../repositories/balance.repository.js";

export class BalanceService {

    constructor(
        private readonly repository: BalanceRepository
    ) {}

    async getBalance(
        walletId: string,
        tokenId: string
    ) {
        return this.repository.find(
            walletId,
            tokenId
        );
    }

    async getWalletBalances(
        walletId: string
    ) {
        return this.repository.findByWallet(walletId);
    }

    async updateBalance(
        walletId: string,
        tokenId: string,
        balance: bigint,
        blockNumber: bigint
    ) {
        return this.repository.upsert({
            walletId,
            tokenId,
            balance,
            blockNumber
        });
    }
}