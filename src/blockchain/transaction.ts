import { walletClient, publicClient } from './client.js';
import { parseEther } from 'viem';
import type { Account } from 'viem';

export async function sendETH(account: Account, to: string, amount: number) {
    const hash = await walletClient.sendTransaction({
        account,
        to: to as `0x${string}`,
        value: parseEther(amount.toString()),
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    return {
        hash,
        status: receipt.status,
    };
}
