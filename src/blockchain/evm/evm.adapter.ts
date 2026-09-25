import { isAddress } from 'viem';

import type { SignerService } from '../../services/signer.service.js';
import type { MintService } from '../../services/mint.service.js';
import { publicClient } from '../client.js';
import { executeRpc } from '../rpc.executor.js';

import type {
    BlockchainAdapter,
    BlockchainTransaction,
    MintRequest,
    MintResult,
    TransferRequest,
    TransferSubmission,
} from '../blockchain-adapter.js';

import MiniUSDTAbi from '../../../artifacts/contracts/MiniUSDT.sol/MiniUSDT.json' with { type: 'json' };

export class EvmAdapter implements BlockchainAdapter {
    readonly chain = 'EVM';

    constructor(
        private readonly signerService: SignerService,
        private readonly mintService: MintService,
    ) {}

    validateAssetIdentifier(identifier: string): boolean {
        return isAddress(identifier);
    }

    // Thin dispatch in front of MintService, unchanged — mint is an
    // admin-gated platform operation signed with a single operator key,
    // not a per-wallet action, and that design was already correct
    // before this adapter existed. See ADR-012.
    async mint(request: MintRequest): Promise<MintResult> {
        const receipt = await this.mintService.mint(
            request.assetIdentifier,
            request.toAddress,
            request.amount,
        );

        return { txHash: receipt.transactionHash };
    }

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
