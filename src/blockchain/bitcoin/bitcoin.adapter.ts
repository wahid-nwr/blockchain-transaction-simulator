import { BitcoinRpcClient } from './rpc.client.js';

import type {
    BlockchainAdapter,
    BlockchainTransaction,
    TransferRequest,
    TransferSubmission,
} from '../blockchain-adapter.js';

type BitcoinTransaction = {
    confirmations?: number;
    blockhash?: string;
    blockheight?: number;
};

function satoshisToBtc(amount: bigint): number {
    if (amount < 0n) {
        throw new Error('Bitcoin transfer amount cannot be negative');
    }

    // Bitcoin's maximum monetary supply is safely below Number.MAX_SAFE_INTEGER
    // when represented in satoshis.
    if (amount > 21_000_000n * 100_000_000n) {
        throw new Error('Bitcoin transfer amount exceeds maximum supply');
    }

    return Number(amount) / 100_000_000;
}

export class BitcoinAdapter implements BlockchainAdapter {
    readonly chain = 'BITCOIN';

    constructor(private readonly rpc: BitcoinRpcClient) {}

    async submitTransfer(request: TransferRequest): Promise<TransferSubmission> {
        const txHash = await this.rpc.call<string>(
            'sendtoaddress',
            [request.toAddress, satoshisToBtc(request.amount)],
            true,
        );

        return { txHash };
    }

    async getTransaction(txHash: string): Promise<BlockchainTransaction> {
        const transaction = await this.rpc.call<BitcoinTransaction>('getrawtransaction', [
            txHash,
            true,
        ]);

        // getrawtransaction omits `confirmations`/`blockheight` entirely
        // for a transaction that's still only in the mempool — it does
        // NOT throw the way an unmined EVM transaction lookup does. So
        // confirmations of 0 here means "still propagating," not "this
        // transaction failed," and must be reported as 'pending' rather
        // than as a terminal outcome. (Bitcoin has no on-chain revert
        // concept once a transaction is actually confirmed — a genuine
        // 'failed' status isn't reachable from this method today. A
        // transaction that's dropped from the mempool without ever
        // confirming instead surfaces as an RPC "not found" error, which
        // the caller already treats as retryable — see
        // ConfirmationProcessor.handleConfirmationError.)
        const confirmations = transaction.confirmations ?? 0;

        return {
            txHash,
            blockNumber: transaction.blockheight != null ? BigInt(transaction.blockheight) : null,
            confirmations,
            status: confirmations > 0 ? 'confirmed' : 'pending',
            gasUsed: null,
        };
    }
}
