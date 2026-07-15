import { publicClient, walletClient } from "./client.js";
import { parseUnits } from "viem";
import MiniUSDTAbi from "../../artifacts/contracts/MiniUSDT.sol/MiniUSDT.json" with {
    type: "json"
};

const TOKEN_ADDRESS = process.env.TOKEN_ADDRESS! as `0x${string}`;

export async function getBalance(
    address:string
) {
    return publicClient.readContract({
        address:TOKEN_ADDRESS,
        abi:MiniUSDTAbi.abi,
        functionName:"balanceOf",
        args:[
            address
        ]
    });
}

export async function mint(
    account:any,
    receiver:string,
    amount:number
) {
    const hash = await walletClient.writeContract({
        account,
        address:TOKEN_ADDRESS,
        abi:MiniUSDTAbi.abi,
        functionName:"mint",
        args:[ receiver, parseUnits(amount.toString(), 6)]
    });
    return hash;
}