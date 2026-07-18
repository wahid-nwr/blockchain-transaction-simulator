import { FastifyInstance } from 'fastify';
import { UserRepository } from '../repositories/user.repository.js';
import { RefreshTokenRepository } from '../repositories/refresh-token.repository.js';
import { hashPassword, verifyPassword } from '../auth/password.service.js';
import {
    createAccessToken,
    createRefreshToken,
    getRefreshTokenExpiry,
    verifyToken,
    JwtPayload,
} from '../auth/jwt.service.js';
import { Role } from '@prisma/client';

export class AuthService {
    constructor(
        private readonly userRepository: UserRepository,
        private readonly refreshTokenRepository: RefreshTokenRepository,
    ) {}

    async register(email: string, password: string, tenantId: string) {
        const passwordHash = await hashPassword(password);
        return this.userRepository.createUser({
            email: email,
            passwordHash,
            role: Role.USER,
            tenantId: tenantId,
        });
    }

    async login(app: FastifyInstance, email: string, password: string) {
        const user = await this.userRepository.findUserByEmail(email);
        if (!user) {
            throw new Error('Invalid email or password');
        }
        const validPassword = await verifyPassword(password, user.passwordHash);

        if (!validPassword) {
            throw new Error('Invalid email or password');
        }

        const payload: JwtPayload = {
            id: user.id,
            email: user.email,
            role: user.role,
            tenantId: user.tenantId,
        };

        const accessToken = createAccessToken(app, payload);

        const refreshToken = createRefreshToken(app, payload);

        await this.refreshTokenRepository.create({
            userId: user.id,
            token: refreshToken,
            expiresAt: getRefreshTokenExpiry(),
        });

        return {
            accessToken,
            refreshToken,
            expiresIn: 900,
        };
    }

    async refresh(app: FastifyInstance, token: string) {
        const payload = verifyToken(app, token);

        const stored = await this.refreshTokenRepository.findByToken(token);
        if (!stored) {
            throw new Error('Invalid refresh token');
        }

        if (stored.expiresAt < new Date()) {
            throw new Error('Refresh token expired');
        }

        const accessToken = createAccessToken(app, {
            id: payload.id,
            email: payload.email,
            role: payload.role,
            tenantId: payload.tenantId,
        });

        return {
            accessToken,
            expiresIn: 900,
        };
    }
}
