import { prisma } from '../database/prisma.js';
import { hashToken } from '../utils/crypto.hash.js';

export class RefreshTokenRepository {
    create(data: {
        userId: string;
        token: string;
        expiresAt: Date;
    }) {
        return prisma.refreshToken.create({
            data: {
                userId: data.userId,
                tokenHash: hashToken(data.token),
                expiresAt: data.expiresAt,
            },
        });
    }

    findByToken(token: string) {
        return prisma.refreshToken.findUnique({
            where: {
                tokenHash: hashToken(token),
            },
        });
    }

    deleteByToken(token: string) {
        return prisma.refreshToken.delete({
            where: {
                tokenHash: hashToken(token),
            },
        });
    }
}
