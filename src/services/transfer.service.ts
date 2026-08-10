import { LedgerService } from './ledger.service.js';
import { TokenService } from './token.service.js';
import { WalletService } from './wallet.service.js';
import { SignerService } from './signer.service.js';
import { Errors } from '../common/errors/errors.js';
import { TransferRequest } from './dto/transfer.js';
import { Transaction } from '@prisma/client';
import { transactionConfirmationQueue } from '../queues/index.js';
import { parseUnits } from 'viem';
import { logTransactionEvent } from '../observability/transaction.logger.js';
import { incrementMetric, observeMetric } from '../observability/metrics.js';
import {
    transactionsSubmittedTotal,
    transactionSubmissionDurationSeconds,
} from '../observability/transaction.metrics.js';

import MiniUSDTAbi from '../../artifacts/contracts/MiniUSDT.sol/MiniUSDT.json' with { type: 'json' };

export class TransferService {
    constructor(
        private readonly ledger: LedgerService,
        private readonly walletService: WalletService,
        private readonly tokenService: TokenService,
        private readonly signerService: SignerService,
    ) {}

    async transfer(request: TransferRequest) {
        let transaction: Transaction;
        const token = await this.tokenService.getToken(request.tokenId);

        const fromWallet = await this.walletService.getWalletById(request.fromWalletId);

        if (
            !fromWallet ||
            fromWallet.tenantId !== request.tenantId ||
            fromWallet.ownerId !== request.userId
        ) {
            throw Errors.walletNotFound();
        }

        const toWallet = await this.walletService.getWalletById(request.toWalletId);

        if (!toWallet) {
            throw Errors.walletNotFound();
        }

        let transactionId: string | undefined;

        try {
            transaction = await this.ledger.createPending({
                tenantId: request.tenantId,
                tokenId: request.tokenId,
                fromWalletId: fromWallet.id,
                toWalletId: toWallet.id,
                amount: BigInt(request.amount),
            });
            transactionId = transaction.id;

            // Signing capability is resolved server-side by wallet id — the client
            // never sends key material. Throws WALLET_NOT_CUSTODIAL if this wallet
            // isn't a platform-held wallet (e.g. it's EXTERNAL/user-owned).
            const walletClient = await this.signerService.getWalletClientFor(
                fromWallet.id,
                request.tenantId,
            );

            logTransactionEvent('transaction.submission.started', {
                transactionId: transaction.id,
                tenantId: transaction.tenantId,
                tokenId: token.id,
                walletId: fromWallet.id,
                amount: BigInt(request.amount),
            });
            const submissionStartedAt = performance.now();

            const hash = await walletClient.writeContract({
                address: token.contractAddress as `0x${string}`,
                abi: MiniUSDTAbi.abi,
                functionName: 'transfer',
                args: [toWallet.address, parseUnits(request.amount.toString(), token.decimals)],
            });

            const submissionDuration = (performance.now() - submissionStartedAt) / 1000;

            incrementMetric(transactionsSubmittedTotal, {
                tenantId: transaction.tenantId,
                tokenId: transaction.tokenId,
            });

            observeMetric(transactionSubmissionDurationSeconds, submissionDuration, {
                tenantId: transaction.tenantId,
                tokenId: transaction.tokenId,
            });
            logTransactionEvent('transaction.submission.completed', {
                transactionId: transaction.id,
                tenantId: transaction.tenantId,
                tokenId: token.id,
                walletId: fromWallet.id,
                txHash: hash,
                status: 'SUBMITTED',
            });

            transaction = await this.ledger.attachHash(transaction.id, hash);

            await transactionConfirmationQueue.add(
                'confirm',
                {
                    transactionId: transaction.id,
                    tenantId: transaction.tenantId,
                },
                {
                    attempts: 5,

                    backoff: {
                        type: 'exponential',
                        delay: 5000,
                    },

                    removeOnComplete: true,

                    removeOnFail: false,
                },
            );
            return transaction;
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
