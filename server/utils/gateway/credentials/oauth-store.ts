import { z } from "zod";
import type { GatewayDb } from "../storage/contracts";
import { gatewayDatabase } from "../storage/database";
import { capabilityIdSchema } from "../capabilities/schemas";
import type { McpOAuthStateRecord, McpOAuthStateStore } from "./oauth-service";

const stateHashSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const runtimeIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u);
const callbackPathSchema = z.string().regex(/^\/api\/capabilities\/mcp\/oauth\/callback$/u);

export function createMcpOAuthStateStore(
  db: GatewayDb,
  now: () => number = Date.now,
): McpOAuthStateStore {
  return {
    async create(record) {
      const normalized = normalizeRecord(record);
      await db.execute(
        `INSERT INTO credential_oauth_states (
           state_hash, user_id, project_id, capability_id, runtime_id, callback_path,
           expires_at, consumed_at, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
        [
          normalized.stateHash,
          normalized.userId,
          normalized.projectId,
          normalized.capabilityId,
          normalized.runtimeId,
          normalized.callbackPath,
          normalized.expiresAt,
          normalized.createdAt,
        ],
      );
    },

    async consume(stateHash, userId) {
      const hash = stateHashSchema.parse(stateHash);
      const owner = positiveId(userId, "user ID");
      return await db.transaction(async (tx) => {
        const row = await tx.one(
          "SELECT * FROM credential_oauth_states WHERE state_hash = ? FOR UPDATE",
          [hash],
        );
        if (row === null) return null;
        const record = rowToRecord(row);
        if (
          record.userId !== owner ||
          record.consumedAt !== null ||
          Date.parse(record.expiresAt) <= now()
        ) {
          return null;
        }
        const consumedAt = new Date(now()).toISOString();
        await tx.execute(
          `UPDATE credential_oauth_states SET consumed_at = ?
           WHERE state_hash = ? AND consumed_at IS NULL`,
          [consumedAt, hash],
        );
        return { ...record, consumedAt };
      });
    },
  };
}

export const mcpOAuthStateStore: McpOAuthStateStore = {
  create(record) {
    return createMcpOAuthStateStore(gatewayDatabase()).create(record);
  },
  consume(stateHash, userId) {
    return createMcpOAuthStateStore(gatewayDatabase()).consume(stateHash, userId);
  },
};

function normalizeRecord(record: McpOAuthStateRecord): McpOAuthStateRecord {
  return {
    stateHash: stateHashSchema.parse(record.stateHash),
    userId: positiveId(record.userId, "user ID"),
    projectId: nullablePositiveId(record.projectId, "project ID"),
    capabilityId: capabilityIdSchema.parse(record.capabilityId),
    runtimeId: runtimeIdSchema.parse(record.runtimeId),
    callbackPath: callbackPathSchema.parse(record.callbackPath),
    expiresAt: timestamp(record.expiresAt),
    consumedAt: record.consumedAt === null ? null : timestamp(record.consumedAt),
    createdAt: timestamp(record.createdAt),
  };
}

function rowToRecord(row: Record<string, unknown>): McpOAuthStateRecord {
  return normalizeRecord({
    stateHash: requiredText(row.state_hash, "state_hash"),
    userId: Number(row.user_id),
    projectId: row.project_id === null ? null : Number(row.project_id),
    capabilityId: requiredText(row.capability_id, "capability_id"),
    runtimeId: requiredText(row.runtime_id, "runtime_id"),
    callbackPath: requiredText(row.callback_path, "callback_path"),
    expiresAt: requiredText(row.expires_at, "expires_at"),
    consumedAt: row.consumed_at === null ? null : requiredText(row.consumed_at, "consumed_at"),
    createdAt: requiredText(row.created_at, "created_at"),
  });
}

function positiveId(value: number, label: string) {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`Invalid ${label}`);
  return value;
}

function nullablePositiveId(value: number | null, label: string) {
  return value === null ? null : positiveId(value, label);
}

function timestamp(value: string) {
  if (!Number.isFinite(Date.parse(value))) throw new Error("Invalid OAuth state timestamp");
  return value;
}

function requiredText(value: unknown, label: string) {
  if (typeof value !== "string" || value === "") throw new Error(`Invalid ${label}`);
  return value;
}
