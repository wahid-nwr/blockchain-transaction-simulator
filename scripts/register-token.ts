import "dotenv/config";
import { prisma } from "../src/database/prisma.js";
import { TokenRepository } from "../src/repositories/token.repository.js";

async function main(){
    const repository = new TokenRepository();
    const token = await repository.create({
        name: "Mini Tether USD",
        symbol: "mUSDT",
        contractAddress: process.env.TOKEN_ADDRESS!,
        decimals: 6
    });
    console.log(token);
}

main().finally(async() => {
    await prisma.$disconnect();
});