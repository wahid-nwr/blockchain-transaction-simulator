import { FastifyInstance } from "fastify";
import { authenticate } from "../middleware/auth.middleware.js";
import { authorize } from "../middleware/role.middleware.js";
import { Role } from "@prisma/client";

export default async function tokenRoutes(
    app: FastifyInstance
) {
    app.post(
        "/admin-test",
        {
            preHandler: [
                authenticate,
                authorize([Role.ADMIN])
            ]
        },
        async (request, reply) => {
            return reply.send({
                data: {
                    message: "Admin access granted",
                    user: request.user.email
                },
                requestId: request.id
            });
        }
    );
}