import { z } from "zod";
import type { CapabilityChangeResult, CapabilitySyncRecord } from "~~/shared/types";
import type { GatewayDb } from "../storage/contracts";
import { gatewayDatabase } from "../storage/database";

const hashSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const operationSchema = z.enum([
  "installSkill",
  "removeSkill",
  "setSkillEnabled",
  "installPlugin",
  "uninstallPlugin",
  "upgradePlugin",
  "setPluginEnabled",
  "setAppEnabled",
  "configureMcp",
  "removeMcp",
]);
const resultSchema = z
  .object({
    capabilityId: z.string().min(1),
    operation: operationSchema,
    status: z.enum(["applied", "unsupportedCapability", "failed"]),
    safeMessage: z.string(),
  })
  .strict();
const statusSchema = z.enum(["pending", "running", "succeeded", "failed"]);

export interface CapabilitySyncStore {
  get(userId: number, projectId: number | null): Promise<CapabilitySyncRecord | null>;
  list(userId?: number): Promise<CapabilitySyncRecord[]>;
  begin(
    userId: number,
    projectId: number | null,
    desiredHash: string,
  ): Promise<CapabilitySyncRecord>;
  finish(
    userId: number,
    projectId: number | null,
    input: {
      actualHash: string;
      status: "succeeded" | "failed";
      results: CapabilityChangeResult[];
      safeError: string | null;
    },
  ): Promise<CapabilitySyncRecord>;
}

export function createCapabilitySyncStore(
  db: GatewayDb,
  now: () => string = () => new Date().toISOString(),
): CapabilitySyncStore {
  return {
    async get(userId, projectId) {
      const scope = normalizeScope(userId, projectId);
      const row = await db.one(
        `SELECT * FROM capability_syncs
         WHERE user_id = ? AND project_id <=> ?`,
        [scope.userId, scope.projectId],
      );
      return row === null ? null : rowToSync(row);
    },

    async list(userId) {
      const rows =
        userId === undefined
          ? await db.many(
              "SELECT * FROM capability_syncs ORDER BY user_id ASC, project_id ASC, id ASC",
            )
          : await db.many(
              `SELECT * FROM capability_syncs
               WHERE user_id = ? ORDER BY project_id ASC, id ASC`,
              [positiveId(userId, "user ID")],
            );
      return rows.map(rowToSync);
    },

    async begin(userId, projectId, desiredHash) {
      const scope = normalizeScope(userId, projectId);
      const timestamp = now();
      await db.execute(
        `INSERT INTO capability_syncs (
           user_id, project_id, desired_hash, actual_hash, status, results_json,
           safe_error, attempt_count, created_at, updated_at
         ) VALUES (?, ?, ?, NULL, 'running', '[]', NULL, 1, ?, ?)
         ON DUPLICATE KEY UPDATE
           id = LAST_INSERT_ID(id),
           desired_hash = VALUES(desired_hash),
           actual_hash = NULL,
           status = 'running',
           results_json = '[]',
           safe_error = NULL,
           attempt_count = attempt_count + 1,
           updated_at = VALUES(updated_at)`,
        [scope.userId, scope.projectId, hashSchema.parse(desiredHash), timestamp, timestamp],
      );
      return await requiredSync(db, scope.userId, scope.projectId);
    },

    async finish(userId, projectId, input) {
      const scope = normalizeScope(userId, projectId);
      const results = z.array(resultSchema).parse(input.results);
      await db.execute(
        `UPDATE capability_syncs SET
           actual_hash = ?, status = ?, results_json = ?, safe_error = ?, updated_at = ?
         WHERE user_id = ? AND project_id <=> ?`,
        [
          hashSchema.parse(input.actualHash),
          statusSchema.extract(["succeeded", "failed"]).parse(input.status),
          JSON.stringify(results),
          input.safeError,
          now(),
          scope.userId,
          scope.projectId,
        ],
      );
      return await requiredSync(db, scope.userId, scope.projectId);
    },
  };
}

export const capabilitySyncStore: CapabilitySyncStore = {
  get(userId, projectId) {
    return createCapabilitySyncStore(gatewayDatabase()).get(userId, projectId);
  },
  list(userId) {
    return createCapabilitySyncStore(gatewayDatabase()).list(userId);
  },
  begin(userId, projectId, desiredHash) {
    return createCapabilitySyncStore(gatewayDatabase()).begin(userId, projectId, desiredHash);
  },
  finish(userId, projectId, input) {
    return createCapabilitySyncStore(gatewayDatabase()).finish(userId, projectId, input);
  },
};

async function requiredSync(db: GatewayDb, userId: number, projectId: number | null) {
  const row = await db.one(
    "SELECT * FROM capability_syncs WHERE user_id = ? AND project_id <=> ?",
    [userId, projectId],
  );
  if (row === null) throw new Error("Capability sync record not found");
  return rowToSync(row);
}

function rowToSync(row: Record<string, unknown>): CapabilitySyncRecord {
  return {
    id: positiveId(Number(row.id), "sync ID"),
    userId: positiveId(Number(row.user_id), "user ID"),
    projectId: nullablePositiveId(row.project_id, "project ID"),
    desiredHash: hashSchema.parse(row.desired_hash),
    actualHash: row.actual_hash === null ? null : hashSchema.parse(row.actual_hash),
    status: statusSchema.parse(row.status),
    results: z.array(resultSchema).parse(parseStoredJson(row.results_json)),
    safeError: nullableText(row.safe_error),
    attemptCount: nonnegativeInteger(Number(row.attempt_count), "attempt count"),
    createdAt: requiredText(row.created_at, "created_at"),
    updatedAt: requiredText(row.updated_at, "updated_at"),
  };
}

function normalizeScope(userId: number, projectId: number | null) {
  return {
    userId: positiveId(userId, "user ID"),
    projectId: nullablePositiveId(projectId, "project ID"),
  };
}

function positiveId(value: number, label: string) {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`Invalid ${label}`);
  return value;
}

function nullablePositiveId(value: unknown, label: string) {
  return value === null ? null : positiveId(Number(value), label);
}

function nonnegativeInteger(value: number, label: string) {
  if (!Number.isInteger(value) || value < 0) throw new Error(`Invalid ${label}`);
  return value;
}

function requiredText(value: unknown, label: string) {
  if (typeof value !== "string" || value === "") throw new Error(`Invalid ${label}`);
  return value;
}

function nullableText(value: unknown) {
  if (value === null) return null;
  if (typeof value !== "string") throw new Error("Invalid nullable text");
  return value;
}

function parseStoredJson(value: unknown) {
  if (typeof value !== "string") throw new Error("Invalid stored JSON");
  return JSON.parse(value) as unknown;
}
