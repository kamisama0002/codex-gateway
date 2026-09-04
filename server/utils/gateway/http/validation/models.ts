import { z } from "zod";

export const modelListSchema = z.object({
  hostId: z.coerce.number().int().positive(),
  includeHidden: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().trim().nullable().optional(),
});

export const modelListResultSchema = z
  .object({
    data: z.array(
      z
        .object({
          id: z.string(),
          model: z.string(),
          displayName: z.string(),
          isDefault: z.boolean().optional(),
        })
        .loose(),
    ),
    nextCursor: z.string().nullable().optional(),
  })
  .loose();
