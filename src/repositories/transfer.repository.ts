import { prisma } from "../database/prisma.js";

export class TransferRepository {
    async create(data:{
        tokenId:string;
        from:string;
        to:string;
        amount:bigint;
        transactionHash:string;
        blockNumber:bigint;
    }) {
        return prisma.tokenTransfer.upsert({
            where:{
                transactionHash: data.transactionHash
            },
            create:data,
            update:{}
        });
    }
}