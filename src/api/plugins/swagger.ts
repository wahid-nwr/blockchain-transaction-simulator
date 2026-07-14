import swagger from "@fastify/swagger";
import swaggerUI from "@fastify/swagger-ui";
import { FastifyInstance } from "fastify";

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
                    url:`http://localhost:${env.PORT}`
                }
            ]
        }
    });

    await app.register(swaggerUI, {
        routePrefix:
        "/docs"
    });
}