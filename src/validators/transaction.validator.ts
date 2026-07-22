import { z } from 'zod';
import { isAddress } from 'viem';
import type { Hex } from 'viem';

const signerSchema = z.object({
    address: z.string().refine((value) => isAddress(value), {
        message: 'Invalid signer address',
    }),

    privateKey: z
        .string()
        .regex(/^0x[a-fA-F0-9]{64}$/, 'Invalid private key format')
        .transform((value) => value as Hex),
});

export const transferSchema = z.object({
    tokenId: z.string().uuid(),

    toWalletId: z.string().uuid(),

    amount: z
        .string()
        .regex(/^\d+$/, 'Amount must be a positive integer')
        .transform((value) => BigInt(value))
        .refine((value) => value > 0n, {
            message: 'Amount must be greater than zero',
        }),

    signer: signerSchema,
});

export type TransferRequest = z.infer<typeof transferSchema>;

export const transactionIdSchema = z.object({
    id: z.string().uuid(),
});