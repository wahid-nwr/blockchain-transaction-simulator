import { z } from 'zod';

const schema = z.object({
    BITCOIN_RPC_URL: z.string().url(),
    BITCOIN_RPC_USER: z.string().min(1),
    BITCOIN_RPC_PASSWORD: z.string().min(1),
    BITCOIN_RPC_WALLET: z.string().min(1),
    BITCOIN_NETWORK: z.enum(['regtest', 'testnet', 'mainnet']).default('regtest'),
});

export function getBitcoinConfig() {
    const result = schema.safeParse(process.env);

    if (!result.success) {
        throw new Error(`Invalid Bitcoin configuration: ${result.error.message}`);
    }

    return result.data;
}
