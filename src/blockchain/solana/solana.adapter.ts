import { Connection, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';

import { SolanaSignerService } from '../../services/solana-signer.service.js';

import type {
    BlockchainAdapter,
    BlockchainTransaction,
    TransferRequest,
    TransferSubmission,
} from '../blockchain-adapter.js';

export class SolanaAdapter implements BlockchainAdapter {
    readonly chain = 'SOLANA';

    // Takes a provider function, not a live Connection, so constructing
    // this adapter (in blockchain-adapters.ts, at process start) never
    // validates SOLANA_RPC_URL — only an actual call does. Tests pass
    // `() => mockConnection`; production passes getSolanaConnection.
    constructor(
        private readonly getConnection: () => Connection,
        private readonly signer: SolanaSignerService,
    ) {}

    // Solana has no token/contract layer in this system — every transfer
    // is native SOL via SystemProgram.transfer, not the SPL Token
    // program. There is no identifier for this to validate, so
    // registration of a Solana-denominated Token is rejected
    // unconditionally rather than silently accepted with nothing
    // downstream able to act on it. See ADR-012.
    validateAssetIdentifier(_identifier: string): boolean {
        return false;
    }

    async submitTransfer(request: TransferRequest): Promise<TransferSubmission> {
        if (request.amount < 0n) {
            throw new Error('Solana transfer amount cannot be negative');
        }

        const connection = this.getConnection();

        // Per-wallet app-held keypair (mirrors EVM's SignerService), not a
        // node-delegated wallet like Bitcoin — see SolanaSignerService and
        // ADR-011 for why.
        const fromKeypair = await this.signer.getKeypairFor(request.walletId, request.tenantId);
        const toPublicKey = new PublicKey(request.toAddress);

        // Fetched immediately before signing: a Solana transaction is only
        // valid for ~60-90 seconds after the blockhash it was built with,
        // after which the network rejects it as expired. This is Solana's
        // analogue of EVM's nonce, but time-bounded rather than an
        // explicitly-incremented counter — there is nothing about this
        // that needs to be visible outside this method (see ADR-010's
        // scoping table).
        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();

        const transaction = new Transaction({
            feePayer: fromKeypair.publicKey,
            blockhash,
            lastValidBlockHeight,
        }).add(
            SystemProgram.transfer({
                fromPubkey: fromKeypair.publicKey,
                toPubkey: toPublicKey,
                lamports: request.amount,
            }),
        );

        transaction.sign(fromKeypair);

        const txHash = await connection.sendRawTransaction(transaction.serialize());

        return { txHash };
    }

    async getTransaction(txHash: string): Promise<BlockchainTransaction> {
        const connection = this.getConnection();

        // getSignatureStatuses does NOT throw for a signature it doesn't
        // recognize — like Bitcoin's getrawtransaction and unlike EVM's
        // getTransactionReceipt, it simply returns `null` in that array
        // slot. That covers both "still propagating" and "never existed";
        // either way it isn't a terminal outcome, so it's reported as
        // 'pending' rather than as a failure — the same reasoning as the
        // Bitcoin adapter's mempool case. See ADR-010.
        const [status] = (await connection.getSignatureStatuses([txHash])).value;

        if (!status) {
            return {
                txHash,
                blockNumber: null,
                confirmations: 0,
                status: 'pending',
                gasUsed: null,
            };
        }

        if (status.err) {
            return {
                txHash,
                blockNumber: BigInt(status.slot),
                confirmations: status.confirmations ?? 0,
                status: 'failed',
                gasUsed: null,
                confirmationLevel: status.confirmationStatus,
            };
        }

        // Solana has three non-error finality levels — 'processed' (seen
        // by the node, not yet voted on), 'confirmed' (supermajority
        // voted), 'finalized' (~32 blocks deep, economically
        // irreversible) — one more than the tri-state ConfirmationStatus
        // has room for. Per ADR-010's scoping: 'processed' maps to
        // 'pending' for ConfirmationProcessor's own retry/terminal
        // branching (it is not yet safe to call this done), while the
        // finer distinction is preserved in confirmationLevel for anyone
        // who wants it — 'confirmed' and 'finalized' both map to this
        // adapter's 'confirmed', since ConfirmationProcessor itself only
        // needs "final and good" vs "not yet" vs "final and bad".
        const isConfirmedOrFinalized =
            status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized';

        let gasUsed: bigint | null = null;

        if (isConfirmedOrFinalized) {
            // A second RPC call, made only once confirmed — the same
            // pattern the Bitcoin adapter uses for getblockheader. Compute
            // units are Solana's closest analogue to EVM's gasUsed.
            const detail = await connection.getTransaction(txHash, {
                maxSupportedTransactionVersion: 0,
            });

            if (detail?.meta?.computeUnitsConsumed != null) {
                gasUsed = BigInt(detail.meta.computeUnitsConsumed);
            }
        }

        return {
            txHash,
            blockNumber: BigInt(status.slot),
            confirmations: status.confirmations ?? 0,
            status: isConfirmedOrFinalized ? 'confirmed' : 'pending',
            gasUsed,
            confirmationLevel: status.confirmationStatus,
        };
    }
}
