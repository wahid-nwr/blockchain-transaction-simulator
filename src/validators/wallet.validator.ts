import { z } from "zod";

export const createWalletSchema = z.object({
    tenantId: z.uuid(),
    chainId: z.number().int(),
    address: z.string()
});

export const walletParamsSchema = z.object({
    id: z.uuid()
});