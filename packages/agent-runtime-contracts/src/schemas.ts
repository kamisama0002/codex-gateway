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

const runtimeTerminalCwdSchema = z
  .string()
  .min(1)
  .max(4096)
  .refine(
    (value) =>
      (value === "/workspace" || value.startsWith("/workspace/")) &&
      !value.split("/").some((segment) => segment === "." || segment === "..") &&
      !value.includes("\0"),
    "Runtime terminal cwd must stay within /workspace",
  );
const runtimeTerminalDimensionSchema = z.number().int().positive().max(1000);

export const runtimeTerminalOpenSchema = z
  .object({
    type: z.literal("open"),
    cwd: runtimeTerminalCwdSchema,
    cols: runtimeTerminalDimensionSchema,
    rows: runtimeTerminalDimensionSchema,
  })
  .strict();
export type RuntimeTerminalOpen = z.infer<typeof runtimeTerminalOpenSchema>;

export const runtimeTerminalClientMessageSchema = z.discriminatedUnion("type", [
  runtimeTerminalOpenSchema,
  z
    .object({
      type: z.literal("input"),
      data: z
        .string()
        .refine((value) => new TextEncoder().encode(value).byteLength <= 64 * 1024),
    })
    .strict(),
  z
    .object({
      type: z.literal("resize"),
      cols: runtimeTerminalDimensionSchema,
      rows: runtimeTerminalDimensionSchema,
    })
    .strict(),
  z.object({ type: z.literal("close") }).strict(),
]);
export type RuntimeTerminalClientMessage = z.infer<typeof runtimeTerminalClientMessageSchema>;

export const runtimeTerminalServerMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ready") }).strict(),
  z.object({ type: z.literal("output"), data: z.string() }).strict(),
  z.object({ type: z.literal("exit"), code: z.number().int().nullable() }).strict(),
  z
    .object({
      type: z.literal("error"),
      code: z.string().regex(/^[a-z][a-z0-9_]{2,127}$/u),
    })
    .strict(),
]);
export type RuntimeTerminalServerMessage = z.infer<typeof runtimeTerminalServerMessageSchema>;

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
