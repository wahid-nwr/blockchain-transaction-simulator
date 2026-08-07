import { prisma } from '../database/prisma.js';
import { hashToken } from '../utils/crypto.hash.js';

export class TenantRepository {
    create(data: { name: string; apiKey: string }) {
        return prisma.tenant.create({
            data,
        });
    }

    async findByApiKey(apiKey: string) {
        const keyHash = hashToken(apiKey);

        const record = await prisma.apiKey.findUnique({
            where: {
                keyHash,
            },
            include: {
                tenant: true,
            },
        });
        console.log('------------------------------apikey------------------------------------');
        console.log(record);
        return record?.tenant ?? null;
    }

    findById(id: string) {
        return prisma.tenant.findUnique({
            where: {
                id,
            },
        });
    }
}
