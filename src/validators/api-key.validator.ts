import { z } from 'zod';

export const createApiKeySchema = z.object({
name: z.string().min(1).max(100),
    scopes: z.array(z.string()).optional(),
    expiresAt: z.coerce.date().optional(),
});

export const apiKeyParamsSchema = z.object({
    id: z.uuid(),
});