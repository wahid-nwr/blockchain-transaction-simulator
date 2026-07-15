import { prisma } from "../database/prisma.js";
import { TransactionStatus } from "@prisma/client";

export class TransactionRepository {
    create(data:any) {
        return prisma.transaction.create({
            data
        });
    }

    updateStatus(
        txHash:string,
        status:TransactionStatus
    ) {
        return prisma.transaction.update({
            where:{
                txHash
            },
            data:{
                status,
                confirmedAt: status==="CONFIRMED"
                    ? new Date()
                    : undefined
            }
        });
    }

    findByHash(
        txHash:string
    ) {
        return prisma.transaction.findUnique({
            where:{
                txHash
            }
        });
    }

    async attachHash(
        id:string,
        txHash:string
    ) {
        return prisma.transaction.update({
            where:{
                id
            },
            data:{
                txHash
            }
        });
    }

    async markFailed(
        id:string
    ) {
        return prisma.transaction.update({
            where:{
                id
            },
            data:{
                status:"FAILED"
            }
        });
    }

    async findPending(){
        return prisma.transaction.findMany({
            where:{
                status:"PENDING",
                txHash:{
                    not:null
                }
            }
        });
    }
}