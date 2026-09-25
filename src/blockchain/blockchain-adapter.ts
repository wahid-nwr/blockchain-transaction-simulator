/**
 * 'pending'   — found, but not yet in a state the adapter can call final.
 *               Callers should treat this the same as "not found yet":
 *               retry later, don't record a terminal outcome.
 * 'confirmed' — final and successful.
 * 'failed'    — final and unsuccessful (e.g. an EVM revert). Distinct from
 *               'pending' specifically so an adapter is never forced to
 *               choose between "not confirmed yet" and "confirmed but bad"
 *               when it only has one boolean to say it with — that
 *               conflation was a real bug for the Bitcoin adapter (an
 *               unconfirmed, still-good mempool transaction was reported
 *               the same way as a genuine failure). See ADR-010.
 */
export type ConfirmationStatus = 'pending' | 'confirmed' | 'failed';

export interface BlockchainTransaction {
    txHash: string;
    blockNumber: bigint | null;
    confirmations: number;
    status: ConfirmationStatus;
    gasUsed: bigint | null;
    /**
     * Optional, adapter-populated detail for chains with more than one
     * non-pending finality level (e.g. Solana's confirmed/finalized
     * distinction). Not read by ConfirmationProcessor's pending/
     * confirmed/failed branching — for observability/logging only.
     * See ADR-010.
     */
    confirmationLevel?: string;
}

export interface TransferRequest {
    tenantId: string;
    walletId: string;
    toAddress: string;
    amount: bigint;
    assetIdentifier?: string;
}

export interface TransferSubmission {
    txHash: string;
}

export interface MintRequest {
    assetIdentifier: string;
    toAddress: string;
    amount: bigint;
}

export interface MintResult {
    txHash: string;
}

export interface BlockchainAdapter {
    readonly chain: string;

    submitTransfer(request: TransferRequest): Promise<TransferSubmission>;

    getTransaction(txHash: string): Promise<BlockchainTransaction>;

    /**
     * Whether `identifier` is a well-formed asset identifier on this chain
     * (an EVM contract address, today). Required on every adapter so
     * registration can reject a malformed or wrong-chain-shaped identifier
     * before it reaches storage — the same role `isValidWalletAddress`
     * already plays for wallet creation. Bitcoin and Solana adapters
     * return `false` unconditionally: neither chain has a token/contract
     * layer in this system yet. See ADR-012.
     */
    validateAssetIdentifier(identifier: string): boolean;

    /**
     * Present only on adapters for chains with an actual mint-capable
     * token layer. Deliberately optional rather than a throwing stub —
     * an absent method lets callers check `if (adapter.mint)` instead of
     * needing to know which chains throw and with what. See ADR-012.
     */
    mint?(request: MintRequest): Promise<MintResult>;
}
