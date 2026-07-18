export interface CreatePendingTransactionRequest {
    tenantId: string;
    tokenId: string;
    fromWalletId: string;
    toWalletId: string;
    amount: bigint;
}
