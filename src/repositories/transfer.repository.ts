import { prisma } from "../database/prisma";

export class TransferRepository {
    async create(data:{
        tokenId:string;
        from:string;
        to:string;
        amount:bigint;
        transactionHash:string;
        blockNumber:bigint;
    }) {
        return prisma.tokenTransfer.create({
            data
        });
    }
}