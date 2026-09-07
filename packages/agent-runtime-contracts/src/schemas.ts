import { z } from "zod";

export const runtimeTypeSchema = z.enum(["codex-app-server", "agents-sdk"]);
export type RuntimeType = z.infer<typeof runtimeTypeSchema>;

export const runtimeStatusSchema = z.enum([
  "absent",
  "provisioning",
  "starting",
  "schema_checking",
  "syncing_capabilities",
  "ready",
  "degraded",
  "restarting",
  "incompatible",
]);
export type RuntimeStatus = z.infer<typeof runtimeStatusSchema>;

export const userAgentRuntimeRecordSchema = z
  .object({
    userId: z.number().int().positive(),
    hostId: z.number().int().positive(),
    runtimeType: runtimeTypeSchema,
    containerId: z.string().min(1).nullable(),
    imageVersion: z.string().min(1),
    runtimeVersion: z.string().min(1),
    schemaHash: z.string().min(1),
    status: runtimeStatusSchema,
    lastError: z.string().min(1).nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();
export type UserAgentRuntimeRecord = z.infer<typeof userAgentRuntimeRecordSchema>;

export const managedRuntimeEndpointSchema = z
  .object({
    runtimeId: z.string().min(1),
    websocketUrl: z.url(),
    serviceToken: z.string().min(1),
  })
  .strict();
export type ManagedRuntimeEndpoint = z.infer<typeof managedRuntimeEndpointSchema>;

export const managedRuntimeStatusSchema = userAgentRuntimeRecordSchema.omit({ containerId: true });
export type ManagedRuntimeStatus = z.infer<typeof managedRuntimeStatusSchema>;

export const runtimeResourcePolicySchema = z
  .object({
    memoryBytes: z
      .number()
      .int()
      .min(128 * 1024 * 1024)
      .max(16 * 1024 * 1024 * 1024),
    nanoCpus: z.number().int().min(250_000_000).max(8_000_000_000),
    pidsLimit: z.number().int().min(32).max(4096),
  })
  .strict();
export type RuntimeResourcePolicy = z.infer<typeof runtimeResourcePolicySchema>;

const assignedRuntimePolicyViewSchema = z
  .object({
    imageAlias: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/),
    memoryMiB: z.number().int().min(128).max(16_384),
    cpuCores: z.number().min(0.25).max(8).multipleOf(0.01),
    pidsLimit: z.number().int().min(32).max(4096),
  })
  .strict();

export const managedRuntimeStatusViewSchema = z
  .object({
    runtime: managedRuntimeStatusSchema.nullable(),
    assignedPolicy: assignedRuntimePolicyViewSchema.nullable(),
    actualResources: runtimeResourcePolicySchema.nullable(),
    currentImageAlias: z
      .string()
      .regex(/^[a-z0-9][a-z0-9._-]{0,63}$/)
      .nullable(),
    requiresRestart: z.boolean(),
    requiresUpgrade: z.boolean(),
  })
  .strict();
export type ManagedRuntimeStatusView = z.infer<typeof managedRuntimeStatusViewSchema>;

export function serializeManagedRuntimeStatus(
  runtime: UserAgentRuntimeRecord,
): ManagedRuntimeStatus {
  const { containerId: _containerId, ...status } = runtime;
  return managedRuntimeStatusSchema.parse(status);
}
