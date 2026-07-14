import { prisma } from "../database/prisma";

export class BalanceRepository {
    async find(
        walletId:string,
        tokenId:string
    ) {
        return prisma.balanceSnapshot.findUnique({
            where:{
                walletId_tokenId:{
                    walletId,
                    tokenId
                }
            }
        });
    }

    async upsert(
        data:{
            walletId:string;
            tokenId:string;
            balance:bigint;
            blockNumber:bigint;
        }
    ) {
        return prisma.balanceSnapshot.upsert({
            where:{
                walletId_tokenId:{
                    walletId:data.walletId,
                    tokenId:data.tokenId
                }
            },
            create:{
                walletId:data.walletId,
                tokenId:data.tokenId,
                balance:data.balance,
                blockNumber:data.blockNumber
            },
            update:{
                balance:data.balance,
                blockNumber:data.blockNumber
            }
        });
    }
}