import { FastifyReply } from "fastify";

export function successResponse<T>(
    reply: FastifyReply,
    data: T,
    statusCode = 200
) {
    return reply.status(statusCode).send({
        data,
        requestId: reply.request.id
    });
}