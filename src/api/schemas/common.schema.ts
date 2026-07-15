import { z } from "zod";

export const apiResponseSchema = <T extends z.ZodTypeAny>(
    dataSchema: T
) => z.object({
    data: dataSchema,
    requestId: z.string()
});