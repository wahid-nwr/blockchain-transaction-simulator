import 'dotenv/config';
import { publicClient, getWalletClient } from '../blockchain/client.js';
import MiniUSDTAbi from '../../artifacts/contracts/MiniUSDT.sol/MiniUSDT.json' with { type: 'json' };

export class MintService {
    async mint(tokenAddress: string, receiver: string, amount: bigint, privateKey: `0x${string}`) {
        const walletClient = getWalletClient(privateKey);

        const hash = await walletClient.writeContract({
            address: tokenAddress as `0x${string}`,
            abi: MiniUSDTAbi.abi,
            functionName: 'mint',
            args: [receiver, amount],
        });

        console.log('Mint transaction:', hash);

        const receipt = await publicClient.waitForTransactionReceipt({
            hash,
        });

        return receipt;
    }
}
