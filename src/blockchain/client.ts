import { createPublicClient, createWalletClient, http } from "viem";
import { localhost } from "viem/chains";

export const publicClient = createPublicClient({
    chain: localhost,
    transport: http("http://127.0.0.1:8545")
});

export const walletClient = createWalletClient({
    chain: localhost,
    transport: http("http://127.0.0.1:8545")
});