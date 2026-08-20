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
    // Initial delay before the confirmation queue's first retry of a job
    // whose receipt lookup failed (exponential backoff from here). 5s is
    // calibrated for real chains (~12s block time on mainnet) — appropriate
    // in production, but needlessly conservative against a local Anvil
    // instance that auto-mines near-instantly, where it shows up as
    // avoidable tail latency (see docs/capacity-planning.md). Override to
    // something much shorter (e.g. 500) for local/dev.
    CONFIRMATION_BACKOFF_DELAY_MS: z.coerce.number().default(5000),

    CONFIRMATION_LOCK_DURATION_MS: z.coerce.number().default(30_000),
    CONFIRMATION_STALLED_INTERVAL_MS: z.coerce.number().default(10_000),
    CONFIRMATION_MAX_STALLED_COUNT: z.coerce.number().int().nonnegative().default(1),
});

export const env = configSchema.parse({
    NODE_ENV: process.env.NODE_ENV,
    PORT: process.env.PORT,
    API_PREFIX: process.env.API_PREFIX,

    JWT_SECRET: process.env.JWT_SECRET,
    JWT_ACCESS_EXPIRES: process.env.JWT_ACCESS_EXPIRES,

    JWT_REFRESH_EXPIRES: process.env.JWT_REFRESH_EXPIRES,

    REDIS_URL: process.env.REDIS_URL,
    CONFIRMATION_BACKOFF_DELAY_MS: process.env.CONFIRMATION_BACKOFF_DELAY_MS,

    CONFIRMATION_LOCK_DURATION_MS: process.env.CONFIRMATION_LOCK_DURATION_MS,
    CONFIRMATION_STALLED_INTERVAL_MS: process.env.CONFIRMATION_STALLED_INTERVAL_MS,
    CONFIRMATION_MAX_STALLED_COUNT: process.env.CONFIRMATION_MAX_STALLED_COUNT,
});
