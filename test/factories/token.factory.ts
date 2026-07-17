import { prisma } from "../../src/database/prisma.js";
import { randomUUID } from "crypto";
import { keccak256, toHex } from "viem";

export async function createToken(
    overrides:any = {}
) {
    return prisma.token.create({
        data:{
            name: overrides.name ?? "Mini USDT",
            symbol: overrides.symbol ?? "USDT",
            contractAddress: overrides.contractAddress ?? `0x${keccak256(toHex(randomUUID())).slice(2,42)}`,
            decimals: overrides.decimals ?? 6,
        }
    });
}