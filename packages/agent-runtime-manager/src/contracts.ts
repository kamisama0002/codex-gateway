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
    providerId: z.string().min(1).max(128).regex(/^[a-z0-9][a-z0-9_-]*$/),
    modelId: z.string().min(1).max(256),
    baseUrl: z.url(),
    wireApi: z.literal("responses"),
    token: z.string().min(1).max(4096),
  })
  .strict();
export type RuntimeProviderConfig = z.infer<typeof providerConfigSchema>;

export const provisionRuntimeRequestSchema = z
  .object({
    runtimeId: runtimeIdSchema,
    userHash: userHashSchema,
    runtimeType: runtimeTypeSchema,
    imageAlias: imageAliasSchema,
    providerConfig: providerConfigSchema.optional(),
  })
  .strict();
export type ProvisionRuntimeRequest = z.infer<typeof provisionRuntimeRequestSchema>;

export const runtimeActionRequestSchema = z.object({ runtimeId: runtimeIdSchema }).strict();
export type RuntimeActionRequest = z.infer<typeof runtimeActionRequestSchema>;

export const upgradeRuntimeRequestSchema = z
  .object({
    runtimeId: runtimeIdSchema,
    imageAlias: imageAliasSchema,
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
  })
  .strict();
export type RuntimeLifecycleResult = z.infer<typeof runtimeLifecycleResultSchema>;

export const runtimeImagePolicySchema = z
  .object({
    image: z.string().min(1),
    imageVersion: z.string().min(1),
  })
  .strict();

export const runtimeManagerPolicySchema = z
  .object({
    images: z.record(imageAliasSchema, runtimeImagePolicySchema),
    internalPort: z.number().int().min(1).max(65_535),
    networkName: z.string().min(1),
    resourceLabels: z.record(z.string().min(1).max(128), z.string().max(256)).default({}),
  })
  .strict()
  .refine(
    (policy) => Object.keys(policy.images).length > 0,
    "at least one image alias is required",
  );

export type { ManagedRuntimeEndpoint, RuntimeType };
