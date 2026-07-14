import { BalanceRepository } from "../repositories/balance.repository";

export class BalanceService {
    constructor(
        private readonly repository: BalanceRepository
    ) {}

    async updateBalance(
        walletId:string,
        tokenId:string,
        balance:bigint,
        blockNumber:bigint
    ) {
        return this.repository.upsert({
            walletId,
            tokenId,
            balance,
            blockNumber
        });
    }
}