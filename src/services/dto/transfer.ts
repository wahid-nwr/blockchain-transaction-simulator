export interface TransferRequest {
    tenantId: string;
    userId: string;
    tokenId: string;
    toWalletId: string;
    amount: bigint;
}
