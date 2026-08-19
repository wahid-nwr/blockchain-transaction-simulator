import { createNonceManager, createPublicClient, createWalletClient, http } from 'viem';

import { privateKeyToAccount } from 'viem/accounts';
import { jsonRpc } from 'viem/nonce';
import { localhost } from 'viem/chains';

export const publicClient = createPublicClient({
    chain: localhost,
    transport: http(process.env.RPC_URL),
});

const nonceManagers = new Map<`0x${string}`, ReturnType<typeof createNonceManager>>();

export function getWalletClient(privateKey: `0x${string}`) {
    if (!privateKey) {
        throw new Error('Private key required');
    }

    const accountWithoutNonceManager = privateKeyToAccount(privateKey);
    const address = accountWithoutNonceManager.address;

    let nonceManager = nonceManagers.get(address);

    if (!nonceManager) {
        nonceManager = createNonceManager({
            source: jsonRpc(),
        });

        nonceManagers.set(address, nonceManager);
    }

    const account = privateKeyToAccount(privateKey, {
        nonceManager,
    });

    return createWalletClient({
        account,
        chain: localhost,
        transport: http(process.env.RPC_URL),
    });
}

export function resetNonceManagers() {
    nonceManagers.clear();
}
