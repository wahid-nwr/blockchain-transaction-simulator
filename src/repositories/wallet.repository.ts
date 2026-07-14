import { prisma } from "../database/prisma";

export class WalletRepository {
    async create(
        tenantId:string,
        address:string
    ) {
        return prisma.wallet.create({
            data:{
                tenantId,
                address
            }
        });
    }

    async findByAddress(
        address:string
    ) {
        return prisma.wallet.findUnique({
            where:{
                address
            }
        });
    }
}