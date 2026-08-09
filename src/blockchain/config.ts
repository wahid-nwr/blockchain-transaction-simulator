import { z } from 'zod';
import { localhost } from 'viem/chains';

const schema = z.object({
    RPC_URL: z.string().url(),
    DEPLOYER_PRIVATE_KEY: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
});

export function getBlockchainConfig() {
    const result = schema.safeParse(process.env);

    if (!result.success) {
        throw new Error(`Invalid blockchain configuration: ${result.error.message}`);
    }

    return result.data;
}

export const chain = localhost;
export const rpcUrl = process.env.RPC_URL;
