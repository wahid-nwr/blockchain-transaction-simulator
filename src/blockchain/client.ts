import { createPublicClient, createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const localChain = {
    id: 31337,
    name: 'Localhost',
    nativeCurrency: {
        name: 'Ether',
        symbol: 'ETH',
        decimals: 18,
    },
    rpcUrls: {
        default: {
            http: ['http://127.0.0.1:8545'],
        },
    },
};

export const publicClient = createPublicClient({
    chain: localChain,
    transport: http(),
});

export const walletClient = getWalletClient();

export function getWalletClient() {
    const account = getAccount();

    return createWalletClient({
        account,
        transport: http(process.env.RPC_URL),
    });
}

function getAccount() {
    return privateKeyToAccount(process.env.DEPLOYER_PRIVATE_KEY as `0x${string}`);
}
