import 'dotenv/config';
import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config({
    path: process.env.NODE_ENV === 'test' ? '.env.test' : '.env',
});

const configSchema = z.object({
    NODE_ENV: z.string().default('development'),
    PORT: z.coerce.number().default(3000),
    API_PREFIX: z.string().default('/api/v1'),
    JWT_SECRET: z.string().default('development-secret'),
    JWT_ACCESS_EXPIRES: z.string().default('15m'),
    JWT_REFRESH_EXPIRES: z.string().default('7d'),
    REDIS_URL: z.string().default('redis://localhost:6379'),
});

export const env = configSchema.parse({
    NODE_ENV: process.env.NODE_ENV,
    PORT: process.env.PORT,
    API_PREFIX: process.env.API_PREFIX,

    JWT_SECRET: process.env.JWT_SECRET,
    JWT_ACCESS_EXPIRES: process.env.JWT_ACCESS_EXPIRES,

    JWT_REFRESH_EXPIRES: process.env.JWT_REFRESH_EXPIRES,

    REDIS_URL: process.env.REDIS_URL,
});
