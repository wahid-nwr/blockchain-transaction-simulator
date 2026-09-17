export interface BlockchainTransaction {
    txHash: string;
    blockNumber: bigint | null;
    confirmations: number;
    success: boolean | null;
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
