import {
    createPublicClient,
    createWalletClient,
    http
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const localChain = {
    id: 31337,
    name: "Localhost",
    nativeCurrency: {
        name: "Ether",
        symbol: "ETH",
        decimals:18
    },
    rpcUrls:{
        default:{
            http:[
                "http://127.0.0.1:8545"
            ]
        }
    }
};

export const publicClient = createPublicClient({
    chain: localChain,
    transport:http()
});


const account = privateKeyToAccount(
    process.env.DEPLOYER_PRIVATE_KEY as `0x${string}`
);

export const walletClient = createWalletClient({
    account,
    chain: localChain,
    transport:http()
});