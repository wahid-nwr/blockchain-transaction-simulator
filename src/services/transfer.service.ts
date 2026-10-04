import { LedgerService } from './ledger.service.js';
import { TokenService } from './token.service.js';
import { WalletService } from './wallet.service.js';
import { Errors } from '../common/errors/errors.js';
import { TransferRequest } from './dto/transfer.js';
import { Transaction } from '@prisma/client';
import { transactionConfirmationQueue } from '../queues/index.js';
import { logTransactionEvent } from '../observability/transaction.logger.js';
import { incrementMetric, observeMetric } from '../observability/metrics.js';
import { BlockchainAdapterRegistry } from '../blockchain/blockchain-adapter.registry.js';
import { JOBS } from '../queues/job.constants.js';
import {
    transactionsSubmittedTotal,
    transactionSubmissionDurationSeconds,
} from '../observability/transaction.metrics.js';

export class TransferService {
    constructor(
        private readonly ledger: LedgerService,
        private readonly walletService: WalletService,
        private readonly tokenService: TokenService,
        private readonly blockchainRegistry: BlockchainAdapterRegistry,
    ) {}

    async transfer(request: TransferRequest) {
        let transaction: Transaction | undefined;
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

        // Signing precondition, checked BEFORE anything is written to the
        // ledger. Previously a transfer from a wallet the platform cannot sign
        // for (e.g. EXTERNAL) created a PENDING row, failed inside the signer
        // and was recorded as a FAILED transaction — a row that could never
        // have succeeded. Now it is rejected as a request error with no ledger
        // side effects. The decision belongs to the chain's adapter because
        // "can sign" differs per chain (Bitcoin signs via the node wallet).
        const adapter = this.blockchainRegistry.get(token.blockchain);
        const custody = await this.walletService.getCustodyStatus(fromWallet.id);

        if (!adapter.canSign(custody)) {
            throw Errors.walletNotCustodial(fromWallet.id);
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
            // never sends key material (the signer re-checks custody as a
            // second line of defence behind the canSign precondition above).
            logTransactionEvent('transaction.submission.started', {
                transactionId: transaction.id,
                tenantId: transaction.tenantId,
                tokenId: token.id,
                walletId: fromWallet.id,
                amount: BigInt(request.amount),
            });
            const submissionStartedAt = performance.now();

            const submission = await adapter.submitTransfer({
                tenantId: request.tenantId,
                walletId: fromWallet.id,
                toAddress: toWallet.address,
                amount: BigInt(request.amount),
                assetIdentifier: token.contractAddress ?? undefined,
            });

            const hash = submission.txHash;

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

            transaction = await this.ledger.markSubmitted(transaction.id, hash);

            await transactionConfirmationQueue.add(JOBS.CONFIRM_TRANSACTION, {
                transactionId: transaction.id,
                tenantId: transaction.tenantId,
            });
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
