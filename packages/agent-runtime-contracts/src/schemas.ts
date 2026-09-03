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

export function serializeManagedRuntimeStatus(
  runtime: UserAgentRuntimeRecord,
): ManagedRuntimeStatus {
  const { containerId: _containerId, ...status } = runtime;
  return managedRuntimeStatusSchema.parse(status);
}
