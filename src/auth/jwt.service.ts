import { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { env } from '../config/env.js';
import { Role } from '@prisma/client';

export interface JwtPayload {
    id: string;
    email: string;
    role: Role;
    tenantId: string;
    jti?: string;
}

export function createAccessToken(app: FastifyInstance, payload: JwtPayload) {
    return app.jwt.sign(payload, {
        expiresIn: env.JWT_ACCESS_EXPIRES,
    });
}

export function createRefreshToken(app: FastifyInstance, payload: JwtPayload) {
    // A refresh token's hash is stored under a unique DB constraint
    // (RefreshToken.tokenHash), so the signed JWT itself must be unique per
    // issuance. Without a per-token claim, two logins for the same user
    // within the same second produce an identical payload + identical
    // second-resolution `iat`, and therefore a byte-identical JWT — which
    // collides on that constraint. `jti` (JWT ID) is the standard claim for
    // exactly this: a random, per-issuance identifier that guarantees
    // uniqueness regardless of timing, independent of payload contents.
    return app.jwt.sign(
        { ...payload, jti: randomUUID() },
        {
            expiresIn: env.JWT_REFRESH_EXPIRES,
        },
    );
}

export function verifyToken(app: FastifyInstance, token: string) {
    return app.jwt.verify<JwtPayload>(token);
}

export function getRefreshTokenExpiry(): Date {
    const expires = env.JWT_REFRESH_EXPIRES;
    const now = Date.now();
    const match = expires.match(/^(\d+)([smhd])$/);
    if (!match) {
        throw new Error(`Invalid JWT_REFRESH_EXPIRES format: ${expires}`);
    }
    const value = Number(match[1]);
    const unit = match[2];
    const multipliers: Record<string, number> = {
        s: 1000,
        m: 60 * 1000,
        h: 60 * 60 * 1000,
        d: 24 * 60 * 60 * 1000,
    };
    return new Date(now + value * multipliers[unit]);
}
