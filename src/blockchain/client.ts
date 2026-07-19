import { createPublicClient, createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { getBlockchainConfig } from './config.js';
import { anvil } from 'viem/chains';

import type { Hex, WalletClient, Transport } from 'viem';

import type { Account } from 'viem/accounts';

type AppWalletClient = WalletClient<Transport, typeof anvil, Account>;

export const publicClient = createPublicClient({
    chain: anvil,
    transport: http(),
});

let walletClient: AppWalletClient | undefined;

export function getWalletClient(): AppWalletClient {
    if (!walletClient) {
        const config = getBlockchainConfig();

        const account = privateKeyToAccount(config.DEPLOYER_PRIVATE_KEY as Hex);

        walletClient = createWalletClient({
            account,
            chain: anvil,
            transport: http(config.RPC_URL),
        });
    }

    return walletClient;
}
