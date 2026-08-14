import { z } from 'zod';

export const transferSchema = z.object({
tokenId: z.string().uuid(),

    fromWalletId: z.string().uuid(),

    toWalletId: z.string().uuid(),

    amount: z
        .string()
        .regex(/^\d+$/, 'Amount must be a positive integer')
        .transform((value) => BigInt(value))
        .refine((value) => value > 0n, {
            message: 'Amount must be greater than zero',
        }),
});

export type TransferRequest = z.infer<typeof transferSchema>;

export const transactionIdSchema = z.object({
    id: z.string().uuid(),
});
