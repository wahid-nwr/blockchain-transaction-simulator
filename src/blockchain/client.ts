import { createPublicClient, createWalletClient, http } from 'viem';

import { privateKeyToAccount } from 'viem/accounts';
import { localhost } from 'viem/chains';

export const publicClient = createPublicClient({
    chain: localhost,
    transport: http(process.env.RPC_URL),
});

export function getWalletClient(privateKey: `0x${string}`) {
    if (!privateKey) {
        throw new Error('Private key required');
    }

    const account = privateKeyToAccount(privateKey);

    return createWalletClient({
        account,
        chain: localhost,
        transport: http(process.env.RPC_URL),
    });
}
