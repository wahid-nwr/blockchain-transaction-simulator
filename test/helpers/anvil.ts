import { createTestClient, http, parseEther, type Address } from 'viem';
import { localhost } from 'viem/chains';
import type { Hex } from 'viem';

export const ANVIL_ACCOUNTS = {
    deployer: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as Hex,

    user: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as Hex,

    receiver: '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a' as Hex,
};

const testClient = createTestClient({
    chain: localhost,
    mode: 'anvil',
    transport: http(process.env.RPC_URL ?? 'http://127.0.0.1:8545'),
});

// Funds an arbitrary address via Anvil's setBalance cheat code — used so
// freshly generated per-test private keys (which aren't among Anvil's
// pre-funded default accounts) can still pay gas for real on-chain calls.
export async function fundAccount(address: Address, ethAmount = '10') {
    await testClient.setBalance({
        address,
        value: parseEther(ethAmount),
    });
}
