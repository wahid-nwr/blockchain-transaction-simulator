import { FastifyInstance } from "fastify";
import { registerTokenSchema, mintTokenSchema }  from "../../validators/token.validator.js";
import { authenticate } from "../middleware/auth.middleware.js";
import { authorize } from "../middleware/role.middleware.js";
import { Role } from "@prisma/client";
import { TokenRepository } from "../../repositories/token.repository.js";
import { TokenService } from "../../services/token.service.js";
import { MintService } from "../../services/mint.service.js";

const tokenService = new TokenService(
    new TokenRepository(),
    new MintService()
);

export default async function tokenRoutes(
    app: FastifyInstance
) {
    app.post(
        "/",
        {
            preHandler: [
                authenticate,
                authorize([Role.ADMIN])
            ]
        },
        async (request, reply) => {
            const body = registerTokenSchema.parse(
                request.body
            );
            const token = await tokenService.registerToken(body);
            return reply.code(201).send({
                data: token,
                requestId: request.id
            });
        }
    );

    app.get(
        "/",
        {
            preHandler: [
                authenticate,
                authorize([Role.ADMIN])
            ]
        },
        async (request, reply) => {
            const tokens = await tokenService.getTokens();
            return reply.send({
                data: tokens,
                requestId: request.id
            });
        }
    );

    app.get(
        "/:id",
        {
            preHandler: [
                authenticate,
                authorize([Role.ADMIN])
            ]
        },
        async (request, reply) => {
            const { id } = request.params as {
                id: string;
            };
            const token = await tokenService.getToken(id);
            return reply.send({
                data: token,
                requestId: request.id
            });
        }
    );

    app.post(
        "/:id/mint",
        {
            preHandler:[
                authenticate,
                authorize([Role.ADMIN])
            ]
        },
        async (request, reply) => {
            const {
                id
            } = request.params as {
                id:string;
            };
            const body = mintTokenSchema.parse(
                request.body
            );

            const receipt = await tokenService.mintToken(
                id,
                body.receiver,
                BigInt(body.amount)
            );

            return reply.send({
                data:{
                    transactionHash: receipt.transactionHash
                },
                requestId: request.id
            });
        }
    );
}