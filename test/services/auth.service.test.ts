import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthService } from '../../src/services/auth.service.js';
import { Role } from '@prisma/client';
import { FastifyInstance } from 'fastify';

vi.mock('../../src/auth/password.service.js', () => ({
    hashPassword: vi.fn(),

    verifyPassword: vi.fn(),
}));

vi.mock('../../src/auth/jwt.service.js', () => ({
    createAccessToken: vi.fn(),

    createRefreshToken: vi.fn(),

    getRefreshTokenExpiry: vi.fn(),

    verifyToken: vi.fn(),
}));

vi.mock('../../src/services/audit-log.service.js', () => ({
    auditLogService: {
        record: vi.fn(),
    },
}));

import { hashPassword, verifyPassword } from '../../src/auth/password.service.js';
import {
    createAccessToken,
    createRefreshToken,
    getRefreshTokenExpiry,
    verifyToken,
} from '../../src/auth/jwt.service.js';
import { auditLogService } from '../../src/services/audit-log.service.js';

describe('AuthService', () => {
    const userRepository = {
        createUser: vi.fn(),

        findUserByEmail: vi.fn(),
    } as any;

    const refreshTokenRepository = {
        create: vi.fn(),

        findByToken: vi.fn(),
    } as any;

    let service: AuthService;

    const app = {} as FastifyInstance;

    beforeEach(() => {
        vi.clearAllMocks();

        service = new AuthService(userRepository, refreshTokenRepository);
    });

    it('should register user successfully', async () => {
        vi.mocked(hashPassword).mockResolvedValue('hashed-password');

        userRepository.createUser.mockResolvedValue({
            id: 'user-1',

            email: 'test@test.com',
        });

        const result = await service.register('test@test.com', 'password', 'tenant-1');

        expect(hashPassword).toHaveBeenCalledWith('password');

        expect(userRepository.createUser).toHaveBeenCalledWith({
            email: 'test@test.com',

            passwordHash: 'hashed-password',

            role: Role.USER,

            tenantId: 'tenant-1',
        });

        expect(result.id).toBe('user-1');

        expect(auditLogService.record).toHaveBeenCalledWith(
            expect.objectContaining({
                action: 'user.registered',
                tenantId: 'tenant-1',
                resourceId: 'user-1',
            }),
        );
    });

    it('should login successfully', async () => {
        userRepository.findUserByEmail.mockResolvedValue({
            id: 'user-1',

            email: 'test@test.com',

            passwordHash: 'hash',

            role: Role.USER,

            tenantId: 'tenant-1',
        });

        vi.mocked(verifyPassword).mockResolvedValue(true);

        vi.mocked(createAccessToken).mockReturnValue('access-token');

        vi.mocked(createRefreshToken).mockReturnValue('refresh-token');

        vi.mocked(getRefreshTokenExpiry).mockReturnValue(new Date(Date.now() + 10000));

        const result = await service.login(app, 'test@test.com', 'password');

        expect(result).toEqual({
            accessToken: 'access-token',

            refreshToken: 'refresh-token',

            expiresIn: 900,
        });

        expect(refreshTokenRepository.create).toHaveBeenCalled();

        expect(auditLogService.record).toHaveBeenCalledWith(
            expect.objectContaining({
                action: 'auth.login.succeeded',
                tenantId: 'tenant-1',
                resourceId: 'user-1',
            }),
        );
    });

    it('should reject invalid email', async () => {
        userRepository.findUserByEmail.mockResolvedValue(null);

        await expect(service.login(app, 'wrong@test.com', 'password')).rejects.toThrow(
            'Invalid email or password',
        );

        expect(auditLogService.record).toHaveBeenCalledWith(
            expect.objectContaining({
                action: 'auth.login.failed',
                metadata: expect.objectContaining({ reason: 'user_not_found' }),
            }),
        );
    });

    it('should reject invalid password', async () => {
        userRepository.findUserByEmail.mockResolvedValue({
            id: 'user-1',

            email: 'test@test.com',

            passwordHash: 'hash',

            role: Role.USER,

            tenantId: 'tenant-1',
        });

        vi.mocked(verifyPassword).mockResolvedValue(false);

        await expect(service.login(app, 'test@test.com', 'wrong')).rejects.toThrow(
            'Invalid email or password',
        );

        expect(auditLogService.record).toHaveBeenCalledWith(
            expect.objectContaining({
                action: 'auth.login.failed',
                metadata: expect.objectContaining({ reason: 'invalid_password' }),
            }),
        );
    });

    it('should refresh access token', async () => {
        vi.mocked(verifyToken).mockReturnValue({
            id: 'user-1',

            email: 'test@test.com',

            role: Role.USER,

            tenantId: 'tenant-1',
        });

        refreshTokenRepository.findByToken.mockResolvedValue({
            expiresAt: new Date(Date.now() + 10000),
        });

        vi.mocked(createAccessToken).mockReturnValue('new-access-token');

        const result = await service.refresh(app, 'refresh-token');

        expect(result).toEqual({
            accessToken: 'new-access-token',

            expiresIn: 900,
        });
    });

    it('should reject expired refresh token', async () => {
        vi.mocked(verifyToken).mockReturnValue({
            id: 'user-1',

            email: 'test@test.com',

            role: Role.USER,

            tenantId: 'tenant-1',
        });

        refreshTokenRepository.findByToken.mockResolvedValue({
            expiresAt: new Date(Date.now() - 10000),
        });

        await expect(service.refresh(app, 'expired-token')).rejects.toThrow(
            'Refresh token expired',
        );
    });
});
