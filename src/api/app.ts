import Fastify from "fastify";
import swagger from "./plugins/swagger";
import healthRoutes from "./routes/health.routes";
import { API_PREFIX } from "../config/constants.js";

export function buildApp() {
    const app = Fastify({
        logger: {
            level: "info"
        }
    });

    // Swagger
    app.register(swagger);

    // API routes
    app.register(healthRoutes, {
        prefix: API_PREFIX
    });

    // Global error handler
    app.setErrorHandler(
        async (error, request, reply) => {
            app.log.error(error);
            return reply.status(500).send({
                error: "Internal Server Error",
                requestId: request.id
            });
        }
    );
    return app;
}