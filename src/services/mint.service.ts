import "dotenv/config";
import {
    createWalletClient,
    createPublicClient,
    http
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import MiniUSDTAbi from "../../artifacts/contracts/MiniUSDT.sol/MiniUSDT.json" with {
    type: "json"
};


export class MintService {
    async mint(
        tokenAddress: string,
        receiver: string,
        amount: bigint
    ) {
        const account = privateKeyToAccount(
            process.env.DEPLOYER_PRIVATE_KEY! as `0x${string}`
        );

        const walletClient = createWalletClient({
            account,
            chain: foundry,
            transport:
                http(process.env.RPC_URL)
        });

        const publicClient = createPublicClient({
            chain: foundry,
            transport: http(process.env.RPC_URL)
        });

        const hash = await walletClient.writeContract({
            address: tokenAddress as `0x${string}`,
            abi: MiniUSDTAbi.abi,
            functionName: "mint",
            args:[
                receiver,
                amount
            ]
        });

        console.log(
            "Mint transaction:",
            hash
        );

        const receipt = await publicClient.waitForTransactionReceipt({
            hash
        });

        return receipt;
    }
}