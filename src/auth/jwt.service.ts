import { FastifyInstance } from "fastify";

export interface JwtPayload {
    id: string;
    email: string;
    role: string;
}

export function generateAccessToken(
    app: FastifyInstance,
    payload: JwtPayload
) {
    return app.jwt.sign(payload);
}

export function verifyToken(
    app: FastifyInstance,
    token: string
) {
    return app.jwt.verify<JwtPayload>(token);
}