import { createNonceManager, createPublicClient, createWalletClient, http } from 'viem';

import { privateKeyToAccount } from 'viem/accounts';
import { jsonRpc } from 'viem/nonce';
import { localhost } from 'viem/chains';

export const publicClient = createPublicClient({
    chain: localhost,
    transport: http(process.env.RPC_URL),
    // Disable viem's block-number cache (default ~4s, from pollingInterval).
    // This client is a module-level singleton reused across the whole process
    // (including across test cases against a local anvil node that can be
    // reset mid-run). Without this, a stale cached block number can outlive
    // a chain reset/rollback and get used downstream, causing
    // BlockOutOfRangeError or similarly inconsistent reads.
    cacheTime: 0,
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
