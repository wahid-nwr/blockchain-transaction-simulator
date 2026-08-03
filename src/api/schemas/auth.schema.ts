import { z } from 'zod';
import { apiResponseSchema } from './common.schema.js';

export const userResponseSchema = apiResponseSchema(
    z.object({
        id: z.string(),
        email: z.string(),
        role: z.string(),
        createdAt: z.string(),
    }),
);
