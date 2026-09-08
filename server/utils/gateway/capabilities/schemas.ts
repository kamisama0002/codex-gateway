import { z } from "zod";

export const capabilityIdSchema = z
  .string()
  .trim()
  .min(6)
  .max(128)
  .regex(/^org__[a-z0-9][a-z0-9_.-]*$/u, "Capability ID must use the org__ namespace");

export const capabilityVersionSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._+-]*$/u);

const capabilitySourceSchema = z
  .object({
    type: z.enum(["builtin", "git", "internal", "upload"]),
    locator: z.string().trim().min(1).max(2_048),
  })
  .strict()
  .superRefine((source, context) => {
    if (source.type === "git") {
      let url: URL;
      try {
        url = new URL(source.locator);
      } catch {
        context.addIssue({ code: "custom", message: "Git capability source is invalid" });
        return;
      }
      const validProtocol = url.protocol === "https:" || url.protocol === "ssh:";
      const containsCredentials =
        url.password !== "" || (url.protocol === "https:" && url.username !== "");
      if (!validProtocol) {
        context.addIssue({ code: "custom", message: "Git capability source is invalid" });
      } else if (containsCredentials || url.search !== "" || url.hash !== "") {
        context.addIssue({
          code: "custom",
          message: "Git capability source must not contain credentials, query or fragment",
        });
      }
    }
    if (source.type === "upload" && !source.locator.startsWith("artifact:")) {
      context.addIssue({ code: "custom", message: "Upload capability source is invalid" });
    }
  });

const skillConfigSchema = z.object({ entryPath: z.literal("SKILL.md") }).strict();

const pluginConfigSchema = z
  .object({
    marketplaceName: z.string().trim().min(1).max(128),
    marketplaceUrl: z.url().refine((value) => value.startsWith("https://")),
    pluginName: z.string().trim().min(1).max(128),
  })
  .strict();

const appConfigSchema = z.object({ appId: z.string().trim().min(1).max(256) }).strict();

export const MCP_STDIO_EXECUTABLES = [
  "node",
  "npx",
  "playwright-mcp",
  "python3",
  "uv",
  "uvx",
] as const;

const stdioMcpConfigSchema = z
  .object({
    transport: z.literal("stdio"),
    command: z.enum(MCP_STDIO_EXECUTABLES, { error: "MCP executable is not allowed" }),
    args: z.array(z.string().max(2_048)).max(64),
  })
  .strict();

const environmentNameSchema = z.string().regex(/^[A-Z][A-Z0-9_]{0,127}$/u);
const sensitiveFieldsSchema = z
  .array(environmentNameSchema)
  .max(32)
  .transform((values) => [...new Set(values)].sort());
const httpHeaderNameSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/u);
const httpHeadersSchema = z
  .record(httpHeaderNameSchema, z.string().max(4_096))
  .refine((headers) => Object.keys(headers).length <= 32, "Too many MCP HTTP headers");
const environmentHttpHeadersSchema = z
  .record(httpHeaderNameSchema, environmentNameSchema)
  .refine((headers) => Object.keys(headers).length <= 32, "Too many MCP environment headers");

const httpMcpConfigSchema = z
  .object({
    transport: z.literal("streamable_http"),
    url: z.string().trim().min(1).max(2_048),
    bearerTokenEnvVar: environmentNameSchema.optional(),
    httpHeaders: httpHeadersSchema.optional(),
    envHttpHeaders: environmentHttpHeadersSchema.optional(),
  })
  .strict()
  .superRefine((config, context) => {
    if (!isAllowedMcpUrl(config.url)) {
      context.addIssue({
        code: "custom",
        message: "External MCP URLs must use HTTPS",
        path: ["url"],
      });
    }
  });

const capabilityConfigSchema = z.union([
  skillConfigSchema,
  pluginConfigSchema,
  appConfigSchema,
  stdioMcpConfigSchema,
  httpMcpConfigSchema,
]);

const commonDefinitionShape = {
  id: capabilityIdSchema,
  displayName: z.string().trim().min(1).max(128),
  description: z.string().trim().min(1).max(2_000),
  version: capabilityVersionSchema,
  source: capabilitySourceSchema,
  sensitiveFields: sensitiveFieldsSchema.default([]),
  enabled: z.boolean().default(true),
  createdByUserId: z.number().int().positive().nullable().default(null),
};

const capabilityCreateInputSchema = z.discriminatedUnion("kind", [
  z
    .object({ ...commonDefinitionShape, kind: z.literal("skill"), config: skillConfigSchema })
    .strict(),
  z
    .object({ ...commonDefinitionShape, kind: z.literal("plugin"), config: pluginConfigSchema })
    .strict(),
  z.object({ ...commonDefinitionShape, kind: z.literal("app"), config: appConfigSchema }).strict(),
  z
    .object({
      ...commonDefinitionShape,
      kind: z.literal("mcp"),
      config: z.discriminatedUnion("transport", [stdioMcpConfigSchema, httpMcpConfigSchema]),
    })
    .strict(),
  z
    .object({ ...commonDefinitionShape, kind: z.literal("search"), config: httpMcpConfigSchema })
    .strict(),
]);

const capabilityUpdateInputSchema = z
  .object({
    displayName: commonDefinitionShape.displayName.optional(),
    description: commonDefinitionShape.description.optional(),
    version: capabilityVersionSchema.optional(),
    source: capabilitySourceSchema.optional(),
    config: capabilityConfigSchema.optional(),
    sensitiveFields: sensitiveFieldsSchema.optional(),
    enabled: z.boolean().optional(),
  })
  .strict();

export const capabilityAssignmentMutationSchema = z
  .object({
    userId: z.number().int().positive(),
    projectId: z.number().int().positive().nullable(),
    assigned: z.boolean(),
  })
  .strict();

export const capabilityArtifactInputSchema = z
  .object({
    capabilityId: capabilityIdSchema,
    version: capabilityVersionSchema,
    sha256: z.string().regex(/^[a-f0-9]{64}$/u),
    storagePath: z.string().startsWith("/data/capabilities/").max(4_096),
    sizeBytes: z
      .number()
      .int()
      .nonnegative()
      .max(1024 * 1024 * 1024),
  })
  .strict();

export type NormalizedCapabilityCreateInput = z.infer<typeof capabilityCreateInputSchema>;

export function parseCapabilityCreateInput(value: unknown) {
  return capabilityCreateInputSchema.parse(value);
}

export function parseCapabilityUpdateInput(value: unknown) {
  return capabilityUpdateInputSchema.parse(value);
}

export function parseCapabilityArtifactInput(value: unknown) {
  return capabilityArtifactInputSchema.parse(value);
}

function isAllowedMcpUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "") {
    return false;
  }
  if (url.protocol === "https:") return true;
  if (url.protocol !== "http:") return false;
  const hostname = url.hostname.toLowerCase();
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]") return true;
  if (!hostname.includes(".")) return /^[a-z0-9][a-z0-9-]*$/u.test(hostname);
  const parts = hostname.split(".").map(Number);
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return false;
  }
  return (
    parts[0] === 10 ||
    (parts[0] === 172 && parts[1] !== undefined && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168)
  );
}
