import swagger from "@fastify/swagger";
import { FastifyInstance } from "fastify";
import { env } from "../../config/env.js";
import { jsonSchemaTransform } from "fastify-type-provider-zod";

export default async function swaggerPlugin(
    app: FastifyInstance
) {
    await app.register(swagger, {
        openapi: {
            info: {
                title: "Blockchain Transaction Simulator API",
                description: "Stablecoin and blockchain transaction platform",
                version: "1.0.0"
            },
            servers: [
                {
                    url: `http://localhost:${env.PORT}`
                }
            ]
        },
        transform: jsonSchemaTransform
    });
}