import { walletClient } from '../blockchain/client.js';
import { LedgerService } from './ledger.service.js';
import { TokenRepository } from '../repositories/token.repository.js';
import { WalletRepository } from '../repositories/wallet.repository.js';
import { logger } from '../utils/logger.js';

import MiniUSDTAbi from '../../artifacts/contracts/MiniUSDT.sol/MiniUSDT.json' with { type: 'json' };

export class TransferService {
    constructor(
        private readonly ledger: LedgerService,
        private readonly tokenRepository: TokenRepository,
        private readonly walletRepository: WalletRepository,
    ) {}

    async transfer(request: any) {
        const token = await this.tokenRepository.findById(request.tokenId);
        if (!token) {
            throw new Error('Token not found');
        }

        const fromWallet = await this.walletRepository.findById(request.fromWalletId);

        const toWallet = await this.walletRepository.findById(request.toWalletId);
        if (!fromWallet || !toWallet) {
            throw new Error('Wallet not found');
        }

        logger.info(
            {
                tenantId: request.tenantId,
                tokenId: request.tokenId,
                amount: request.amount,
            },
            'creating pending transaction',
        );

        const transaction = await this.ledger.createPending({
            tenantId: request.tenantId,
            tokenId: request.tokenId,
            fromWalletId: request.fromWalletId,
            toWalletId: request.toWalletId,
            amount: request.amount,
        });

        try {
            const hash = await walletClient.writeContract({
                address: token.contractAddress as `0x${string}`,
                abi: MiniUSDTAbi.abi,
                functionName: 'transfer',
                args: [toWallet.address, request.amount],
            });

            return this.ledger.attachHash(transaction.id, hash);
        } catch (error) {
            await this.ledger.markFailed(transaction.id);
            throw error;
        }
    }
}
