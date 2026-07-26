import { getWalletClient } from '../blockchain/client.js';
import { LedgerService } from './ledger.service.js';
import { TokenService } from './token.service.js';
import { WalletService } from './wallet.service.js';
import { getLogger } from '../observability/index.js';
import { Errors } from '../common/errors/errors.js';
import { TransferRequest } from './dto/transfer.js';
import { parseUnits } from 'viem';

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

        getLogger().info(
            {
                tenantId: request.tenantId,
                tokenId: request.tokenId,
                amount: request.amount,
            },
            'creating pending transaction',
        );

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

            getLogger().info({
                signerAddress: fromWallet.address,
            });
            if (!request.signer) {
                throw Errors.invalidSigner();
            }
            const walletClient = getWalletClient(request.signer.privateKey);

            getLogger().info(
                {
                    account: walletClient.account.address,
                    signer: request.signer.address,
                    to: toWallet.address,
                },
                'executing blockchain transfer',
            );

            const hash = await walletClient.writeContract({
                address: token.contractAddress as `0x${string}`,
                abi: MiniUSDTAbi.abi,
                functionName: 'transfer',
                args: [toWallet.address, parseUnits(request.amount.toString(), token.decimals)],
            });

            getLogger().info(
                {
                    transactionId: transaction.id,
                    hash,
                },
                'blockchain transaction submitted',
            );

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
