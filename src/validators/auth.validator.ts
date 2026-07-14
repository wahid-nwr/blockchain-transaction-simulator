import { z } from "zod";

export const registerSchema = z.object({
    email: z.string().email(),
    password: z.string().min(8)
});

export const userResponseSchema = z.object({
    data: z.object({
        id: z.string(),
        email: z.string().email(),
        role: z.string(),
        createdAt: z.string()
    }),
    requestId: z.string()
});

export type RegisterInput = z.infer<typeof registerSchema>;