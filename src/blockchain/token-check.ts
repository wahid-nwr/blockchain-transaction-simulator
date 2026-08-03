import 'dotenv/config';
import { publicClient } from './client.js';
import MiniUSDTAbi from '../../artifacts/contracts/MiniUSDT.sol/MiniUSDT.json' with { type: 'json' };

async function main() {
    const name = await publicClient.readContract({
        address: process.env.TOKEN_ADDRESS! as `0x${string}`,
        abi: MiniUSDTAbi.abi,
        functionName: 'name',
    });

    const symbol = await publicClient.readContract({
        address: process.env.TOKEN_ADDRESS! as `0x${string}`,
        abi: MiniUSDTAbi.abi,
        functionName: 'symbol',
    });

    console.log({
        name,
        symbol,
    });
}

main();
