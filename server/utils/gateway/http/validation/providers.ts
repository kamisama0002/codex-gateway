import { z } from "zod";

export const upstreamWireApiSchema = z.enum(["responses", "chat_completions"]);

export const modelCapabilitiesSchema = z
  .object({
    tools: z.boolean(),
    streamingTools: z.boolean(),
    vision: z.boolean(),
    reasoning: z.boolean(),
    maxContextTokens: z.number().int().positive().nullable(),
  })
  .strict();

export const providerIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-z0-9][a-z0-9_-]*$/);

export const providerModelIdSchema = z.string().trim().min(1).max(256);
export const providerNameSchema = z.string().trim().min(1).max(128);

export const providerBaseUrlSchema = z.url().superRefine((value, ctx) => {
  const url = new URL(value);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  const development = process.env.NODE_ENV !== "production";
  if (url.protocol !== "https:" && !(development && local && url.protocol === "http:")) {
    ctx.addIssue({ code: "custom", message: "Provider base URL must use HTTPS" });
  }
  if (url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "") {
    ctx.addIssue({ code: "custom", message: "Provider base URL must not contain credentials or query" });
  }
});

export const providerCreateSchema = z
  .object({
    id: providerIdSchema.optional(),
    name: providerNameSchema,
    baseUrl: providerBaseUrlSchema,
    wireApi: upstreamWireApiSchema,
    apiKey: z.string().min(1).max(4096),
    enabled: z.boolean().default(true),
    requestTimeoutMs: z.number().int().min(1000).max(300000).default(30000),
  })
  .strict();

export const providerUpdateSchema = z
  .object({
    name: providerNameSchema.optional(),
    baseUrl: providerBaseUrlSchema.optional(),
    wireApi: upstreamWireApiSchema.optional(),
    apiKey: z.string().max(4096).optional(),
    enabled: z.boolean().optional(),
    requestTimeoutMs: z.number().int().min(1000).max(300000).optional(),
  })
  .strict();

export const providerModelSchema = z
  .object({
    modelId: providerModelIdSchema,
    displayName: z.string().trim().min(1).max(256),
    enabled: z.boolean().default(true),
    capabilities: modelCapabilitiesSchema,
  })
  .strict();

export const providerGrantSchema = z
  .object({
    userId: z.number().int().positive(),
    modelId: providerModelIdSchema,
    granted: z.boolean().default(true),
  })
  .strict();
