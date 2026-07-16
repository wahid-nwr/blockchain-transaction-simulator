import "dotenv/config";
import { MintService } from "../src/services/mint.service.js";

async function main() {
    const service = new MintService();
    const receipt = await service.mint(
        "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
        "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
        1000000000000n
    );
    console.log(
        receipt
    );
}

main();