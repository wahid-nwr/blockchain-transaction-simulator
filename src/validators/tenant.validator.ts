import { z } from 'zod';

export const createTenantSchema = z.object({
    name: z.string().min(3),
});
