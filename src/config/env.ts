import "dotenv/config";
import dotenv from "dotenv";

dotenv.config({
    path: process.env.NODE_ENV === "test"
        ? ".env.test"
        : ".env"
});

export const env = {
    NODE_ENV: process.env.NODE_ENV ?? "development",
    PORT: Number(process.env.PORT ?? 3000),
    API_PREFIX: process.env.API_PREFIX ?? "/api/v1",
    JWT_SECRET: process.env.JWT_SECRET ?? "development-secret",
    JWT_ACCESS_EXPIRES: process.env.JWT_ACCESS_EXPIRES ?? "15m",
    JWT_REFRESH_EXPIRES: process.env.JWT_REFRESH_EXPIRES ?? "7d"
};