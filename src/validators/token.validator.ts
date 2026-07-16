import { z } from "zod";
import { isAddress } from "viem";

export const registerTokenSchema = z.object({
    name: z.string().min(1),
    symbol: z.string().min(1),
    contractAddress: z.string().min(1),
    decimals: z.number().int().positive().default(6)
});

export const mintTokenSchema = z.object({
    receiver: z.string().refine(
        value => isAddress(value),
        "Invalid Ethereum address"
    ),
    amount: z.string().refine(
        value => {
            try {
                return BigInt(value) > 0n;
            }
            catch {
                return false;
            }
        },
        "Invalid amount"
    )
});