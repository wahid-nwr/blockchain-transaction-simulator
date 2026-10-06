import { isAddress, verifyMessage } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { CustodyType } from '@prisma/client';

import type { SignerService } from '../../services/signer.service.js';
import type { MintService } from '../../services/mint.service.js';
import { publicClient } from '../client.js';
import { erc20Abi } from 'viem';
import { executeRpc } from '../rpc.executor.js';
import { TokenBalanceReader, TokenBalanceRequest, TokenBalance } from '../token-balance-reader.js';

import type {
    BlockchainAdapter,
    BlockchainTransaction,
    CustodialWalletMaterial,
    MintRequest,
    MintResult,
    OwnershipVerificationRequest,
    TransferRequest,
    TransferSubmission,
    WalletCustodyStatus,
} from '../blockchain-adapter.js';

import MiniUSDTAbi from '../../../artifacts/contracts/MiniUSDT.sol/MiniUSDT.json' with { type: 'json' };

export class EvmAdapter implements BlockchainAdapter, TokenBalanceReader {
    readonly chain = 'EVM';

    constructor(
        private readonly signerService: SignerService,
        private readonly mintService: MintService,
    ) {}

    validateAssetIdentifier(identifier: string): boolean {
        return isAddress(identifier);
    }

    // SignerService decrypts a wallet's key row to sign, so a wallet is only
    // signable if it is CUSTODIAL *and* that row exists (a CUSTODIAL wallet
    // without one is a data inconsistency, not a signable wallet).
    canSign(wallet: WalletCustodyStatus): boolean {
        return wallet.custodyType === CustodyType.CUSTODIAL && wallet.hasCustodyKey;
    }

    // EIP-191 personal_sign, i.e. what a browser wallet's signMessage produces.
    // EOA signatures only (ecrecover); contract wallets (ERC-1271) would need an
    // RPC round trip and are out of scope. viem throws on a malformed signature
    // (wrong length, bad recovery id), which for this purpose just means
    // "not proven", so it maps to false.
    async verifyOwnership(request: OwnershipVerificationRequest): Promise<boolean> {
        try {
            return await verifyMessage({
                address: request.address as `0x${string}`,
                message: request.message,
                signature: request.signature as `0x${string}`,
            });
        } catch {
            return false;
        }
    }

    async createCustodialWallet(): Promise<CustodialWalletMaterial> {
        const privateKey = generatePrivateKey();

        return {
            address: privateKeyToAccount(privateKey).address,
            secret: privateKey,
        };
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

    async getTokenBalance(request: TokenBalanceRequest): Promise<TokenBalance> {
        if (!request.assetIdentifier) {
            throw new Error('EVM token balance requires an asset contract address');
        }

        const balance = await publicClient.readContract({
            address: request.assetIdentifier as `0x${string}`,
            abi: erc20Abi,
            functionName: 'balanceOf',
            args: [request.walletAddress as `0x${string}`],
            ...(request.blockNumber !== undefined ? { blockNumber: request.blockNumber } : {}),
        });

        return {
            balance: balance as bigint,
            blockNumber: request.blockNumber ?? (await publicClient.getBlockNumber()),
        };
    }
}
