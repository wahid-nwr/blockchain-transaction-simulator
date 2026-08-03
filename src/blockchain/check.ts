import { publicClient } from './client.js';

async function main() {
    const block = await publicClient.getBlockNumber();
    console.log('Current block:', block);
}

main();
