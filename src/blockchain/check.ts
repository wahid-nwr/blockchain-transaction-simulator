import { publicClient } from "./client";

async function main() {
    const block = await publicClient.getBlockNumber();
    console.log(
        "Current block:",
        block
    );
}

main();