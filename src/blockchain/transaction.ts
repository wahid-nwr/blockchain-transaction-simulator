import { getWalletClient, publicClient } from './client.js';
import { parseEther } from 'viem';
import type { Hex } from 'viem';

export async function sendETH(privateKey: Hex, to: string, amount: number) {
    const walletClient = getWalletClient(privateKey);

    const hash = await walletClient.sendTransaction({
        to: to as `0x${string}`,
        value: parseEther(amount.toString()),
    });

    const receipt = await publicClient.waitForTransactionReceipt({
        hash,
    });

    return {
        hash,
        status: receipt.status,
    };
}
