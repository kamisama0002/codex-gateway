import { z } from "zod";

export const runtimeNodeSchedulingStateSchema = z.enum(["active", "draining", "disabled"]);
export type RuntimeNodeSchedulingState = z.infer<typeof runtimeNodeSchedulingStateSchema>;

export const runtimeNodeIdSchema = z
  .string()
  .min(7)
  .max(128)
  .regex(/^node__[a-z0-9][a-z0-9_.-]*$/u);

export const runtimeIdSchema = z
  .string()
  .min(7)
  .max(128)
  .regex(/^codex_[a-f0-9]{32}$/u);

export const runtimeWorkspaceKeySchema = z
  .string()
  .length(36)
  .regex(/^ws__[a-f0-9]{32}$/u);

const runtimeNodeBaseUrlSchema = z.url().refine((value) => {
  const url = new URL(value);
  return (
    (url.protocol === "http:" || url.protocol === "https:") &&
    url.username === "" &&
    url.password === "" &&
    (url.pathname === "" || url.pathname === "/") &&
    url.search === "" &&
    url.hash === ""
  );
}, "Runtime node URL must be an HTTP origin without credentials");

export const runtimeNodeRecordSchema = z
  .object({
    id: runtimeNodeIdSchema,
    name: z.string().trim().min(1).max(255),
    baseUrl: runtimeNodeBaseUrlSchema,
    encryptedSharedSecret: z
      .string()
      .min(1)
      .max(64 * 1024),
    configRevision: z.number().int().positive(),
    schedulingState: runtimeNodeSchedulingStateSchema,
    capacityCpuMillis: z.number().int().positive(),
    capacityMemoryBytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    maxRuntimes: z.number().int().positive(),
    minimumFreeDiskBytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    lastSeenAt: z.iso.datetime().nullable(),
    lastError: z.string().min(1).max(255).nullable(),
    healthJson: z.string().min(1).nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();

export type RuntimeNodeRecord = z.infer<typeof runtimeNodeRecordSchema>;

export const runtimePlacementRecordSchema = z
  .object({
    userId: z.number().int().positive(),
    runtimeId: runtimeIdSchema,
    runtimeNodeId: runtimeNodeIdSchema,
    placementGeneration: z.number().int().positive(),
    workspaceKey: runtimeWorkspaceKeySchema,
    reservedCpuMillis: z.number().int().positive(),
    reservedMemoryBytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    reservedPids: z.number().int().positive(),
  })
  .strict();

export type RuntimePlacementRecord = z.infer<typeof runtimePlacementRecordSchema>;
