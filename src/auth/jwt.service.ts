import { FastifyInstance } from "fastify";
import { env } from "../config/env.js";

export interface JwtPayload {
    id: string;
    email: string;
    role: string;
}

export function createAccessToken(
    app: FastifyInstance,
    payload: JwtPayload
) {
    return app.jwt.sign(payload, {
        expiresIn: env.JWT_ACCESS_EXPIRES
    });
}

export function createRefreshToken(
    app: FastifyInstance,
    payload: JwtPayload
) {
    return app.jwt.sign(payload, {
        expiresIn: env.JWT_REFRESH_EXPIRES
    });
}

export function verifyToken(
    app: FastifyInstance,
    token: string
) {
    return app.jwt.verify<JwtPayload>(token);
}

export function getRefreshTokenExpiry(): Date {
    const expires = env.JWT_REFRESH_EXPIRES;
    const now = Date.now();
    const match = expires.match(
        /^(\d+)([smhd])$/
    );
    if (!match) {
        throw new Error(
            `Invalid JWT_REFRESH_EXPIRES format: ${expires}`
        );
    }
    const value = Number(match[1]);
    const unit = match[2];
    const multipliers: Record<string, number> = {
        s: 1000,
        m: 60 * 1000,
        h: 60 * 60 * 1000,
        d: 24 * 60 * 60 * 1000
    };
    return new Date(
        now + value * multipliers[unit]
    );
}