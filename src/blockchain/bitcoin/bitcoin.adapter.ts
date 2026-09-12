import { BitcoinRpcClient } from './rpc.client.js';

import type {
    BlockchainAdapter,
    BlockchainTransaction,
    TransferRequest,
    TransferSubmission,
} from '../blockchain-adapter.js';

export class BitcoinAdapter implements BlockchainAdapter {
    readonly chain = 'bitcoin';

    constructor(private readonly rpc: BitcoinRpcClient) {}

    async submitTransfer(request: TransferRequest): Promise<TransferSubmission> {
        const txHash = await this.rpc.call<string>('sendtoaddress', [
            request.toAddress,
            Number(request.amount) / 100_000_000,
        ]);

        return {
            txHash,
        };
    }

    async getTransaction(txHash: string): Promise<BlockchainTransaction> {
        const transaction = await this.rpc.call<{
            confirmations?: number;
            blockhash?: string;
            blockheight?: number;
        }>('getrawtransaction', [txHash, true]);

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
