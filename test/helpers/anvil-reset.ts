import { publicClient } from '../../src/blockchain/client.js';

export async function resetAnvil() {
    await publicClient.request({
        method: 'anvil_reset' as any,
    });
}
