export interface TransferRequest {
    tenantId: string;
    userId: string;
    tokenId: string;
    fromWalletId: string;
    toWalletId: string;
    amount: bigint;
}
