import { z } from 'zod';

const schema = z.object({
    SOLANA_RPC_URL: z.string().url(),
    SOLANA_NETWORK: z.enum(['localnet', 'devnet', 'testnet', 'mainnet-beta']).default('localnet'),
});

export function getSolanaConfig() {
    const result = schema.safeParse(process.env);

    if (!result.success) {
        throw new Error(`Invalid Solana configuration: ${result.error.message}`);
    }

    return result.data;
}
