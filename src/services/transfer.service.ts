import { walletClient } from '../blockchain/client.js';
import { LedgerService } from './ledger.service.js';
import { TokenService } from './token.service.js';
import { logger } from '../utils/logger.js';
import { Errors } from '../common/errors/errors.js';
import { WalletService } from './wallet.service.js';

import MiniUSDTAbi from '../../artifacts/contracts/MiniUSDT.sol/MiniUSDT.json' with { type: 'json' };

export class TransferService {
    constructor(
        private readonly ledger: LedgerService,
        private readonly walletService: WalletService,
        private readonly tokenService: TokenService
    ) {}

    async transfer(request: any) {
        const token = await this.tokenService.getToken(request.tokenId);

        const wallets = await this.walletService.getUserWallets(request.userId);

        if (wallets.length === 0) {
            throw Errors.walletNotFound();
        }
        const fromWallet = wallets[0];

        const toWallet = await this.walletService.getWalletById(request.toWalletId);
        if (!toWallet) {
            throw Errors.walletNotFound();
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
            fromWalletId: fromWallet.id,
            toWalletId: toWallet.id,
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
