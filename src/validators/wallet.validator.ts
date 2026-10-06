import { z } from 'zod';

export const createWalletSchema = z
    .object({
        chainId: z.number().int(),
        address: z.string(),
        // Proof of ownership (see WalletOwnershipService). Optional here;
        // REQUIRE_WALLET_OWNERSHIP_PROOF decides whether it is mandatory.
        challenge: z.string().min(1).optional(),
        signature: z.string().min(1).optional(),
    })
    .refine((body) => (body.challenge === undefined) === (body.signature === undefined), {
        message: 'challenge and signature must be provided together',
        path: ['signature'],
    });

export const walletChallengeSchema = z.object({
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
