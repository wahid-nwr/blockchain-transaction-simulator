import { TransferRepository } from '../repositories/transfer.repository.js';
import { TokenRepository } from '../repositories/token.repository.js';
import { WalletRepository } from '../repositories/wallet.repository.js';
import { BalanceSyncService } from './balance-sync.service.js';
import { logger } from '../utils/logger.js';
import { eventListenerEventsSkippedTotal } from '../metrics/event-listener.metrics.js';

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
        logIndex: number;
        blockNumber: bigint;
    }) {
        const token = await this.tokenRepository.findByContractAddress(data.tokenAddress);

        if (!token) {
            throw new Error('Token not registered');
        }

        const existing = await this.transferRepository.findByTransactionHashAndLogIndex(
            data.transactionHash,
            data.logIndex,
        );

        if (!existing) {
            logger.info(
                {
                    data,
                },
                'TRANSFER EVENT RECEIVED',
            );
            await this.transferRepository.create({
                tokenId: token.id,
                from: data.from,
                to: data.to,
                amount: data.amount,
                transactionHash: data.transactionHash,
                logIndex: data.logIndex,
                blockNumber: data.blockNumber,
            });
        } else {
            logger.info(
                {
                    data,
                },
                'SKIPPING EXISTING TRANSFER',
            );
            eventListenerEventsSkippedTotal.inc();
        }

        await this.syncWalletBalance(
            data.from.toLowerCase(),
            token.id,
            token.contractAddress,
            data.blockNumber,
        );

        await this.syncWalletBalance(
            data.to.toLowerCase(),
            token.id,
            token.contractAddress,
            data.blockNumber,
        );
    }

    private async syncWalletBalance(
        address: string,
        tokenId: string,
        tokenAddress: string,
        blockNumber: bigint,
    ) {
        const wallet = await this.walletRepository.findByAddress(address);

        if (!wallet) {
            logger.info(
                {
                    address,
                },
                'Wallet not found for balance sync:',
            );
            return;
        }

        await this.balanceSyncService.sync(
            wallet.id,
            wallet.address,
            tokenId,
            tokenAddress,
            blockNumber,
        );
    }
}
