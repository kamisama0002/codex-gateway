import {
  managedRuntimeEndpointSchema,
  runtimeTypeSchema,
  type ManagedRuntimeEndpoint,
  type RuntimeType,
} from "@codex-gateway/agent-runtime-contracts";
import { z } from "zod";

const runtimeIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/);
const userHashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const imageAliasSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9._-]*$/);

const providerConfigSchema = z
  .object({
    providerId: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[a-z0-9][a-z0-9_-]*$/),
    modelId: z.string().min(1).max(256),
    baseUrl: z.url(),
    wireApi: z.literal("responses"),
    token: z.string().min(1).max(4096),
  })
  .strict();
export type RuntimeProviderConfig = z.infer<typeof providerConfigSchema>;

const runtimeSecretSchema = z
  .object({
    credentialId: z
      .string()
      .min(7)
      .max(128)
      .regex(/^cred__[a-z0-9][a-z0-9_.-]*$/u),
    capabilityId: z
      .string()
      .min(6)
      .max(128)
      .regex(/^org__[a-z0-9][a-z0-9_.-]*$/u),
    version: z.number().int().positive(),
    target: z.discriminatedUnion("type", [
      z
        .object({
          type: z.literal("env"),
          name: z.string().regex(/^[A-Z][A-Z0-9_]{0,127}$/u),
        })
        .strict(),
      z
        .object({
          type: z.literal("file"),
          path: z.string().regex(/^\/run\/codex-secrets\/[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/u),
        })
        .strict(),
    ]),
    value: z
      .string()
      .min(1)
      .max(1024 * 1024),
  })
  .strict();
export type RuntimeSecret = z.infer<typeof runtimeSecretSchema>;

const runtimeSecretsSchema = z
  .array(runtimeSecretSchema)
  .max(64)
  .superRefine((secrets, context) => {
    const targets = secrets.map((secret) => JSON.stringify(secret.target));
    if (new Set(targets).size !== targets.length) {
      context.addIssue({ code: "custom", message: "Runtime secret targets must be unique" });
    }
    if (secrets.reduce((total, secret) => total + Buffer.byteLength(secret.value), 0) > 8_388_608) {
      context.addIssue({ code: "custom", message: "Runtime secret payload is too large" });
    }
  });

export const runtimeResourcePolicySchema = z
  .object({
    memoryBytes: z.number().int().min(128 * 1024 * 1024).max(16 * 1024 * 1024 * 1024),
    nanoCpus: z.number().int().min(250_000_000).max(8_000_000_000),
    pidsLimit: z.number().int().min(32).max(4096),
  })
  .strict();
export type RuntimeResourcePolicy = z.infer<typeof runtimeResourcePolicySchema>;

export const provisionRuntimeRequestSchema = z
  .object({
    runtimeId: runtimeIdSchema,
    userHash: userHashSchema,
    runtimeType: runtimeTypeSchema,
    imageAlias: imageAliasSchema,
    providerConfig: providerConfigSchema.optional(),
    runtimeSecrets: runtimeSecretsSchema.optional(),
    resources: runtimeResourcePolicySchema.optional(),
  })
  .strict();
export type ProvisionRuntimeRequest = z.infer<typeof provisionRuntimeRequestSchema>;

export const runtimeActionRequestSchema = z.object({ runtimeId: runtimeIdSchema }).strict();
export type RuntimeActionRequest = z.infer<typeof runtimeActionRequestSchema>;

export const syncRuntimeSecretsRequestSchema = z
  .object({ runtimeId: runtimeIdSchema, runtimeSecrets: runtimeSecretsSchema })
  .strict();
export type SyncRuntimeSecretsRequest = z.infer<typeof syncRuntimeSecretsRequestSchema>;

export const forwardOAuthCallbackRequestSchema = z
  .object({
    runtimeId: runtimeIdSchema,
    pathAndQuery: z
      .string()
      .min(1)
      .max(32 * 1024)
      .refine((value) => {
        try {
          const url = new URL(value, "http://callback.invalid");
          return (
            url.origin === "http://callback.invalid" &&
            url.pathname === "/api/capabilities/mcp/oauth/callback" &&
            url.hash === "" &&
            url.searchParams.has("state") &&
            (url.searchParams.has("code") || url.searchParams.has("error"))
          );
        } catch {
          return false;
        }
      }, "Invalid MCP OAuth callback"),
  })
  .strict();
export type ForwardOAuthCallbackRequest = z.infer<typeof forwardOAuthCallbackRequestSchema>;

export const runtimeResourceActionRequestSchema = z
  .object({ runtimeId: runtimeIdSchema, resources: runtimeResourcePolicySchema.optional() })
  .strict();
export type RuntimeResourceActionRequest = z.infer<typeof runtimeResourceActionRequestSchema>;

export const upgradeRuntimeRequestSchema = z
  .object({
    runtimeId: runtimeIdSchema,
    imageAlias: imageAliasSchema,
    resources: runtimeResourcePolicySchema.optional(),
  })
  .strict();
export type UpgradeRuntimeRequest = z.infer<typeof upgradeRuntimeRequestSchema>;

export const runtimeLifecycleStatusSchema = z.enum(["absent", "stopped", "running"]);
export type RuntimeLifecycleStatus = z.infer<typeof runtimeLifecycleStatusSchema>;

export const runtimeLifecycleResultSchema = z
  .object({
    runtimeId: runtimeIdSchema,
    containerId: z.string().min(1).nullable(),
    imageAlias: imageAliasSchema.nullable(),
    imageVersion: z.string().min(1).nullable(),
    status: runtimeLifecycleStatusSchema,
    endpoint: managedRuntimeEndpointSchema.nullable(),
    actualResources: runtimeResourcePolicySchema.nullable(),
  })
  .strict();
export type RuntimeLifecycleResult = z.infer<typeof runtimeLifecycleResultSchema>;

export const agentContainerStatsSchema = z
  .object({
    sampledAtMs: z.number().int().nonnegative(),
    cpuUsage: z.number().nonnegative(),
    systemCpuUsage: z.number().nonnegative(),
    preCpuUsage: z.number().nonnegative(),
    preSystemCpuUsage: z.number().nonnegative(),
    onlineCpus: z.number().int().positive(),
    memoryUsageBytes: z.number().nonnegative(),
    memoryLimitBytes: z.number().positive(),
    rxBytes: z.number().nonnegative(),
    txBytes: z.number().nonnegative(),
    diskReadBytes: z.number().nonnegative(),
    diskWriteBytes: z.number().nonnegative(),
    interfaces: z.array(z.string().min(1)).min(1),
    cpuQuotaCpus: z.number().positive(),
  })
  .strict();
export type AgentContainerStats = z.infer<typeof agentContainerStatsSchema>;

export const agentRuntimeStatsResultSchema = z
  .object({
    runtimeId: runtimeIdSchema,
    status: runtimeLifecycleStatusSchema,
    stats: agentContainerStatsSchema.nullable(),
  })
  .strict();
export type AgentRuntimeStatsResult = z.infer<typeof agentRuntimeStatsResultSchema>;

export const execRuntimeRequestSchema = z
  .object({
    runtimeId: runtimeIdSchema,
    command: z
      .string()
      .min(1)
      .max(64 * 1024),
    timeoutMs: z.number().int().positive().max(60_000),
    maxOutputBytes: z
      .number()
      .int()
      .positive()
      .max(4 * 1024 * 1024),
  })
  .strict();
export type ExecRuntimeRequest = z.infer<typeof execRuntimeRequestSchema>;

export const execRuntimeResultSchema = z
  .object({
    code: z.number().int().nullable(),
    stdout: z.string(),
    stderr: z.string(),
  })
  .strict();
export type ExecRuntimeResult = z.infer<typeof execRuntimeResultSchema>;

export const runtimeImagePolicySchema = z
  .object({
    image: z.string().min(1),
    imageVersion: z.string().min(1),
  })
  .strict();

const dockerNetworkNameSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/u)
  .refine((value) => !["bridge", "host", "none"].includes(value), {
    message: "Reserved Docker network names are not allowed",
  });

const oauthCallbackUrlSchema = z.url().refine((value) => {
  const url = new URL(value);
  return (
    (url.protocol === "http:" || url.protocol === "https:") &&
    url.username === "" &&
    url.password === "" &&
    url.pathname === "/api/capabilities/mcp/oauth/callback" &&
    url.search === "" &&
    url.hash === ""
  );
}, "Invalid MCP OAuth callback URL");

export const runtimeManagerPolicySchema = z
  .object({
    images: z.record(imageAliasSchema, runtimeImagePolicySchema),
    internalPort: z.number().int().min(1).max(65_535),
    networkNames: z
      .tuple([dockerNetworkNameSchema, dockerNetworkNameSchema])
      .refine(([internal, egress]) => internal !== egress, {
        message: "Agent runtime requires two different networks",
      }),
    oauthCallbackUrl: oauthCallbackUrlSchema.optional(),
    resourceLabels: z.record(z.string().min(1).max(128), z.string().max(256)).default({}),
    agentMemoryBytes: z
      .number()
      .int()
      .min(128 * 1024 * 1024)
      .max(16 * 1024 * 1024 * 1024)
      .default(8 * 1024 * 1024 * 1024),
    agentNanoCpus: z.number().int().min(250_000_000).max(8_000_000_000).default(4_000_000_000),
    agentPidsLimit: z.number().int().min(32).max(4_096).default(1_024),
  })
  .strict()
  .refine(
    (policy) => Object.keys(policy.images).length > 0,
    "at least one image alias is required",
  );

export type { ManagedRuntimeEndpoint, RuntimeType };
