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
        const txHash = await this.rpc.call<string>('sendtoaddress', [
            request.toAddress,
            satoshisToBtc(request.amount),
        ]);

        return { txHash };
    }

    async getTransaction(txHash: string): Promise<BlockchainTransaction> {
        const transaction = await this.rpc.call<BitcoinTransaction>('getrawtransaction', [
            txHash,
            true,
        ]);

        const confirmations = transaction.confirmations ?? 0;

        return {
            txHash,
            blockNumber: transaction.blockheight != null ? BigInt(transaction.blockheight) : null,
            confirmations,
            success: confirmations > 0,
            gasUsed: null,
        };
    }
}
