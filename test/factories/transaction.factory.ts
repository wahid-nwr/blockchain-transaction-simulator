import { prisma } from "../../src/database/prisma.js";

export async function createTransaction(
    overrides:any = {}
){
    const {
        tenantId,
        tokenId,
        fromWalletId,
        toWalletId,
        ...rest
    } = overrides;

    return prisma.transaction.create({
        data:{
            tenant:{
                connect:{
                    id: tenantId
                }
            },
            token:{
                connect:{
                    id: tokenId
                }
            },
            fromWallet:{
                connect:{
                    id: fromWalletId
                }
            },
            toWallet:{
                connect:{
                    id: toWalletId
                }
            },
            amount:1000n,
            status:"PENDING",
            ...rest
        }
    });
}