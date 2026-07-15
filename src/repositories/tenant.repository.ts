import { prisma } from "../database/prisma.js";

export class TenantRepository {
    create(data: {
        name: string;
        apiKey: string;
    }) {
        return prisma.tenant.create({
            data
        });
    }

    findByApiKey(apiKey: string) {
        return prisma.tenant.findUnique({
            where: {
                apiKey
            }
        });
    }

    findById(id: string) {
        return prisma.tenant.findUnique({
            where: {
                id
            }
        });
    }
}