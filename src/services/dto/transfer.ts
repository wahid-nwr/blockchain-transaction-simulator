import type { Signer } from '../../blockchain/signer.js';

export interface TransferRequest {
    tenantId: string;
    userId: string;
    tokenId: string;
    toWalletId: string;
    amount: bigint;
    signer: Signer;
}
