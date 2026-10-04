import { z } from 'zod';

export const createWalletSchema = z.object({
    chainId: z.number().int(),
    address: z.string(),
});

// No address: for a custodial wallet the platform generates the keypair.
export const createCustodialWalletSchema = z.object({
    chainId: z.number().int(),
});

export const walletParamsSchema = z.object({
    id: z.uuid(),
});
