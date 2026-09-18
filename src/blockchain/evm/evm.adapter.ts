import type { SignerService } from '../../services/signer.service.js';
import { publicClient } from '../client.js';
import { executeRpc } from '../rpc.executor.js';

import type {
    BlockchainAdapter,
    BlockchainTransaction,
    TransferRequest,
    TransferSubmission,
} from '../blockchain-adapter.js';

import MiniUSDTAbi from '../../../artifacts/contracts/MiniUSDT.sol/MiniUSDT.json' with { type: 'json' };

export class EvmAdapter implements BlockchainAdapter {
    readonly chain = 'EVM';

    constructor(private readonly signerService: SignerService) {}

    async submitTransfer(request: TransferRequest): Promise<TransferSubmission> {
        if (!request.assetIdentifier) {
            throw new Error('EVM transfer requires an asset contract address');
        }

        const walletClient = await this.signerService.getWalletClientFor(
            request.walletId,
            request.tenantId,
        );

        const hash = await walletClient.writeContract({
            address: request.assetIdentifier as `0x${string}`,
            abi: MiniUSDTAbi.abi,
            functionName: 'transfer',
            args: [request.toAddress as `0x${string}`, request.amount],
        });

        return {
            txHash: hash,
        };
    }

    async getTransaction(txHash: string): Promise<BlockchainTransaction> {
        const receipt = await executeRpc('getTransactionReceipt', () =>
            publicClient.getTransactionReceipt({
                hash: txHash as `0x${string}`,
            }),
        );

        // A receipt only exists once the transaction is mined, so there is
        // no 'pending' case to represent here: getTransactionReceipt
        // throws (caught upstream as a retryable "not found yet") for a
        // transaction that isn't mined, and every receipt it does return
        // is terminal — either the call succeeded or it reverted.
        return {
            txHash,
            blockNumber: receipt.blockNumber,
            confirmations: 1,
            status: receipt.status === 'success' ? 'confirmed' : 'failed',
            gasUsed: receipt.gasUsed,
        };
    }
}
