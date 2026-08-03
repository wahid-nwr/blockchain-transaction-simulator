import { prisma } from '../database/prisma.js';

export class RefreshTokenRepository {
    create(data: { userId: string; token: string; expiresAt: Date }) {
        return prisma.refreshToken.create({
            data,
        });
    }

    findByToken(token: string) {
        return prisma.refreshToken.findUnique({
            where: {
                token,
            },
        });
    }

    deleteByToken(token: string) {
        return prisma.refreshToken.delete({
            where: {
                token,
            },
        });
    }
}
