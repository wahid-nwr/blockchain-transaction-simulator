import { FastifyInstance } from "fastify";
import { register } from "../../services/auth.service.js";
import { registerSchema, userResponseSchema } from "../../validators/auth.validator.js";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { successResponse } from "../utils/response.js";

export default async function authRoutes(
    app: FastifyInstance
) {
    const api = app.withTypeProvider<ZodTypeProvider>();
    api.post(
        "/register",
        {
            schema: {
                body: registerSchema,
                response: { 201: userResponseSchema }
            }
        },
        async (request, reply) => {
            const user = await register(
                request.body.email,
                request.body.password
            );

            return successResponse(
                reply,
                {
                    id: user.id,
                    email: user.email,
                    role: user.role,
                    createdAt: user.createdAt.toISOString()
                },
                201
            );
        }
    );
}