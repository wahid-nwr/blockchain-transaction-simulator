import "dotenv/config";
import { createWalletClient, createPublicClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import MiniUSDTAbi from "../../artifacts/contracts/MiniUSDT.sol/MiniUSDT.json";

export class MintService {
    async mint(
        receiver:string,
        amount:bigint
    ) {
        const account = privateKeyToAccount(
            process.env.DEPLOYER_PRIVATE_KEY! as `0x${string}`
        );
        const walletClient = createWalletClient({
            account,
            transport: http(process.env.RPC_URL)
        });
        const publicClient = createPublicClient({
            transport: http(process.env.RPC_URL)
        });
        const hash = await walletClient.writeContract({
            address: process.env.TOKEN_ADDRESS! as `0x${string}`,
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