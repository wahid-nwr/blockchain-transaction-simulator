import { publicClient, getWalletClient } from './client.js';
import { parseUnits } from 'viem';
import type { Hex } from 'viem';

import MiniUSDTAbi from '../../artifacts/contracts/MiniUSDT.sol/MiniUSDT.json' with { type: 'json' };

export async function getBalance(tokenAddress: `0x${string}`, address: `0x${string}`) {
    return publicClient.readContract({
        address: tokenAddress,
        abi: MiniUSDTAbi.abi,
        functionName: 'balanceOf',
        args: [address],
    });
}

export async function mint(
    privateKey: Hex,
    tokenAddress: `0x${string}`,
    receiver: `0x${string}`,
    amount: number,
) {
    const walletClient = getWalletClient(privateKey);

    const hash = await walletClient.writeContract({
        address: tokenAddress,
        abi: MiniUSDTAbi.abi,
        functionName: 'mint',
        args: [receiver, parseUnits(amount.toString(), 6)],
    });

    return hash;
}
