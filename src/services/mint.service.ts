import { publicClient, getWalletClient } from '../blockchain/client.js';
import MiniUSDTAbi from '../../artifacts/contracts/MiniUSDT.sol/MiniUSDT.json' with { type: 'json' };
import type { Hex } from 'viem';

// Minting is a privileged platform operation (route is Role.ADMIN-gated),
// not a per-user wallet action — so unlike transfers, it's signed with a
// single operator key resolved server-side from config, never from the
// request body. In production this env var should be sourced from a real
// secrets manager, not committed to a plain .env file.
function getMinterPrivateKey(): Hex {
    const privateKey = process.env.PRIVATE_KEY;
    if (!privateKey) {
        throw new Error('PRIVATE_KEY is not configured — required to sign mint transactions');
    }
    return privateKey as Hex;
}

export class MintService {
    async mint(tokenAddress: string, receiver: string, amount: bigint) {
        const walletClient = getWalletClient(getMinterPrivateKey());

        const hash = await walletClient.writeContract({
            address: tokenAddress as `0x${string}`,
            abi: MiniUSDTAbi.abi,
            functionName: 'mint',
            args: [receiver, amount],
        });

        const receipt = await publicClient.waitForTransactionReceipt({
            hash,
        });

        return receipt;
    }
}
