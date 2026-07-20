import type { Hex } from 'viem';

export interface TransferRequest {
    tenantId: string;
    userId: string;
    tokenId: string;
    toWalletId: string;
    amount: bigint;
    signer: {
        address: string;
        privateKey: Hex;
    };
}
