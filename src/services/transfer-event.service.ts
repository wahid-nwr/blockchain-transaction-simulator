import { TransferRepository } from "../repositories/transfer.repository.js";
import { TokenRepository } from "../repositories/token.repository.js";
import { WalletRepository } from "../repositories/wallet.repository.js";
import { BalanceSyncService } from "./balance-sync.service.js";

export class TransferEventService {

    private readonly transferRepository = new TransferRepository();
    private readonly tokenRepository = new TokenRepository();
    private readonly walletRepository = new WalletRepository();
    private readonly balanceSyncService = new BalanceSyncService();

    async handleTransferEvent(data: {
        tokenAddress: string;
        from: string;
        to: string;
        amount: bigint;
        transactionHash: string;
        blockNumber: bigint;
    }) {
        const token = await this.tokenRepository.findByContractAddress(
            data.tokenAddress
        );

        if (!token) {
            throw new Error("Token not registered");
        }

        await this.transferRepository.create({
            tokenId: token.id,
            from: data.from,
            to: data.to,
            amount: data.amount,
            transactionHash: data.transactionHash,
            blockNumber: data.blockNumber
        });

        await this.syncWalletBalance(
            data.from,
            token.id,
            token.contractAddress,
            data.blockNumber
        );

        await this.syncWalletBalance(
            data.to,
            token.id,
            token.contractAddress,
            data.blockNumber
        );
    }

    private async syncWalletBalance(
        address: string,
        tokenId: string,
        tokenAddress: string,
        blockNumber: bigint
    ) {
        const wallet = await this.walletRepository.findByAddress(address);

        if (!wallet) {
            return;
        }

        await this.balanceSyncService.sync(
            wallet.id,
            wallet.address,
            tokenId,
            tokenAddress,
            blockNumber
        );
    }
}