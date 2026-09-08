import { z } from "zod";
import { runtimeNodeHealthSchema } from "./client";
import {
  runtimeNodeIdSchema,
  runtimeNodeSchedulingStateSchema,
  type RuntimeNodeRecord,
} from "./runtime-node-types";

export const runtimeNodeCapacitySchema = z
  .object({
    cpuMillis: z.number().int().positive(),
    memoryBytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    maxRuntimes: z.number().int().positive(),
    minimumFreeDiskBytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  })
  .strict();

export const runtimeNodeReservationSchema = z
  .object({
    cpuMillis: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    memoryBytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    pids: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    runtimes: z.number().int().nonnegative(),
  })
  .strict();

export const runtimeNodeHealthViewSchema = z
  .object({
    managerVersion: z.string().min(1).max(128),
    availableDiskBytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    totalDiskBytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    dockerAvailable: z.boolean(),
    dataRootWritable: z.boolean(),
    managedRuntimeCount: z.number().int().nonnegative(),
    runningRuntimeCount: z.number().int().nonnegative(),
    lastSeenAt: z.iso.datetime().nullable(),
    lastError: z.string().min(1).max(255).nullable(),
  })
  .strict();

export const runtimeNodeAdminViewSchema = z
  .object({
    id: runtimeNodeIdSchema,
    name: z.string().trim().min(1).max(255),
    state: runtimeNodeSchedulingStateSchema,
    configRevision: z.number().int().positive(),
    capacity: runtimeNodeCapacitySchema,
    reservation: runtimeNodeReservationSchema,
    health: runtimeNodeHealthViewSchema.nullable(),
  })
  .strict();

export type RuntimeNodeAdminView = z.infer<typeof runtimeNodeAdminViewSchema>;

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

export const runtimeNodeAdminCreateInputSchema = z
  .object({
    id: runtimeNodeIdSchema,
    name: z.string().trim().min(1).max(255),
    baseUrl: runtimeNodeBaseUrlSchema,
    sharedSecret: z
      .string()
      .min(1)
      .max(64 * 1024),
    state: runtimeNodeSchedulingStateSchema.optional().default("active"),
    capacity: runtimeNodeCapacitySchema,
  })
  .strict();

export const runtimeNodeAdminPatchInputSchema = z
  .object({
    name: z.string().trim().min(1).max(255).optional(),
    sharedSecret: z
      .string()
      .min(1)
      .max(64 * 1024)
      .optional(),
    state: runtimeNodeSchedulingStateSchema.optional(),
    capacity: runtimeNodeCapacitySchema.optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.name !== undefined ||
      value.sharedSecret !== undefined ||
      value.state !== undefined ||
      value.capacity !== undefined,
    "At least one field must be provided",
  );

export type RuntimeNodeAdminCreateInput = z.infer<typeof runtimeNodeAdminCreateInputSchema>;
export type RuntimeNodeAdminPatchInput = z.infer<typeof runtimeNodeAdminPatchInputSchema>;

export function runtimeNodeHealthViewFromRecord(record: RuntimeNodeRecord) {
  const parsed = runtimeNodeHealthSchema.safeParse(parseJson(record.healthJson));
  return parsed.success
    ? {
        health: {
          managerVersion: parsed.data.managerVersion,
          availableDiskBytes: parsed.data.availableDiskBytes,
          totalDiskBytes: parsed.data.totalDiskBytes,
          dockerAvailable: parsed.data.dockerAvailable,
          dataRootWritable: parsed.data.dataRootWritable,
          managedRuntimeCount: parsed.data.managedRuntimeCount,
          runningRuntimeCount: parsed.data.runningRuntimeCount,
          lastSeenAt: record.lastSeenAt,
          lastError: record.lastError,
        },
      }
    : {
        health:
          record.lastError === null
            ? null
            : {
                managerVersion: "unknown",
                availableDiskBytes: 0,
                totalDiskBytes: 0,
                dockerAvailable: false,
                dataRootWritable: false,
                managedRuntimeCount: 0,
                runningRuntimeCount: 0,
                lastSeenAt: record.lastSeenAt,
                lastError: record.lastError,
              },
      };
}

function parseJson(text: string | null) {
  if (text === null) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}
