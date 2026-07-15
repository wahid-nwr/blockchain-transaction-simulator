import {
    authenticate
} from "../middleware/auth.middleware.js";
import { FastifyInstance } from "fastify";

export default async function walletRoutes(
    app: FastifyInstance
) {
    app.get(
        "/me",
        {
            preHandler: authenticate
        },
        async (request, reply) => {
            return reply.send({
                data: {
                    userId: request.user.id,
                    email: request.user.email,
                    role: request.user.role
                },
                requestId: request.id
            });

        }
    );
}