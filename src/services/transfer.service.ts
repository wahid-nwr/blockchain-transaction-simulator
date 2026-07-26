import { getWalletClient } from '../blockchain/client.js';
import { LedgerService } from './ledger.service.js';
import { TokenService } from './token.service.js';
import { WalletService } from './wallet.service.js';
import { Errors } from '../common/errors/errors.js';
import { TransferRequest } from './dto/transfer.js';
import { parseUnits } from 'viem';
import { logTransactionEvent } from '../observability/transaction.logger.js';

import MiniUSDTAbi from '../../artifacts/contracts/MiniUSDT.sol/MiniUSDT.json' with { type: 'json' };

export class TransferService {
    constructor(
        private readonly ledger: LedgerService,
        private readonly walletService: WalletService,
        private readonly tokenService: TokenService,
    ) {}

    async transfer(request: TransferRequest) {
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

        let transactionId: string | undefined;

        try {
            const transaction = await this.ledger.createPending({
                tenantId: request.tenantId,
                tokenId: request.tokenId,
                fromWalletId: fromWallet.id,
                toWalletId: toWallet.id,
                amount: BigInt(request.amount),
            });
            transactionId = transaction.id;

            if (!request.signer) {
                throw Errors.invalidSigner();
            }
            const walletClient = getWalletClient(request.signer.privateKey);

            logTransactionEvent('transaction.submission.started', {
                transactionId: transaction.id,
                tenantId: transaction.tenantId,
                tokenId: token.id,
                walletId: fromWallet.id,
                amount: BigInt(request.amount),
            });
            const hash = await walletClient.writeContract({
                address: token.contractAddress as `0x${string}`,
                abi: MiniUSDTAbi.abi,
                functionName: 'transfer',
                args: [toWallet.address, parseUnits(request.amount.toString(), token.decimals)],
            });

            logTransactionEvent('transaction.submission.completed', {
                transactionId: transaction.id,
                tenantId: transaction.tenantId,
                tokenId: token.id,
                walletId: fromWallet.id,
                txHash: hash,
                status: 'SUBMITTED',
            });

            return this.ledger.attachHash(transaction.id, hash);
        } catch (error) {
            if (transactionId) {
                return await this.ledger.markFailed(
                    transactionId,
                    error instanceof Error ? error.message : String(error),
                );
            }
            throw error;
        }
    }
}
