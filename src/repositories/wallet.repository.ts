import { prisma } from "../database/prisma.js";

export class WalletRepository {
    create(data: {
        tenantId: string;
        userId: string;
        chainId: number;
        address: string;
    }) {
        return prisma.wallet.create({
            data
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