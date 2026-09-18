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

export interface BlockchainAdapter {
    readonly chain: string;

    submitTransfer(request: TransferRequest): Promise<TransferSubmission>;

    getTransaction(txHash: string): Promise<BlockchainTransaction>;
}
