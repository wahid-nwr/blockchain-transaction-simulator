import { prisma } from "../../src/database/prisma.js";

export async function createToken(
    overrides:any = {}
) {
    return prisma.token.create({
        data:{
            name: overrides.name ?? "Mini USDT",
            symbol: overrides.symbol ?? "USDT",
            contractAddress: overrides.contractAddress ?? `0xtoken-${Date.now()}`,
            decimals: overrides.decimals ?? 6
        }
    });
}