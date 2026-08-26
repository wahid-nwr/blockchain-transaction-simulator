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
import { Errors } from '../common/errors/errors.js';
import { auditLogService } from './audit-log.service.js';

export class AuthService {
    constructor(
        private readonly userRepository: UserRepository,
        private readonly refreshTokenRepository: RefreshTokenRepository,
    ) {}

    async register(email: string, password: string, tenantId: string) {
        const passwordHash = await hashPassword(password);
        const user = await this.userRepository.createUser({
            email: email,
            passwordHash,
            role: Role.USER,
            tenantId: tenantId,
        });

        await auditLogService.record({
            tenantId,
            userId: user.id,
            action: 'user.registered',
            resource: 'User',
            resourceId: user.id,
            metadata: { email: user.email },
        });

        return user;
    }

    async login(app: FastifyInstance, email: string, password: string) {
        const user = await this.userRepository.findUserByEmail(email);
        if (!user) {
            await auditLogService.record({
                action: 'auth.login.failed',
                resource: 'User',
                metadata: { email, reason: 'user_not_found' },
            });
            throw Errors.invalidCredentials('Invalid email or password');
        }
        const validPassword = await verifyPassword(password, user.passwordHash);

        if (!validPassword) {
            await auditLogService.record({
                tenantId: user.tenantId,
                userId: user.id,
                action: 'auth.login.failed',
                resource: 'User',
                resourceId: user.id,
                metadata: { reason: 'invalid_password' },
            });
            throw Errors.invalidCredentials('Invalid email or password');
        }

        await auditLogService.record({
            tenantId: user.tenantId,
            userId: user.id,
            action: 'auth.login.succeeded',
            resource: 'User',
            resourceId: user.id,
        });

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
            throw Errors.invalidToken('Invalid refresh token');
        }

        if (stored.expiresAt < new Date()) {
            throw Errors.invalidToken('Refresh token expired');
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
