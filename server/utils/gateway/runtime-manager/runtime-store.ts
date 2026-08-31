import type { DatabaseSync } from "node:sqlite";
import {
  runtimeStatusSchema,
  userAgentRuntimeRecordSchema,
  type RuntimeStatus,
  type UserAgentRuntimeRecord,
} from "@codex-gateway/agent-runtime-contracts";
import { gatewayDatabase } from "../storage/database";
import { MANAGED_RUNTIME_HOST_ID } from "../storage/migrations";

export function createRuntimeStore(db: DatabaseSync) {
  return {
    getByUserId(userId: number): UserAgentRuntimeRecord | null {
      const row = db
        .prepare("SELECT * FROM user_agent_runtimes WHERE user_id = ?")
        .get(positiveUserId(userId));
      return row === undefined ? null : rowToRuntime(row);
    },

    upsert(input: UserAgentRuntimeRecord): UserAgentRuntimeRecord {
      const runtime = userAgentRuntimeRecordSchema.parse(input);
      if (runtime.hostId !== MANAGED_RUNTIME_HOST_ID) {
        throw new Error("Managed runtime host ID is invalid");
      }
      const changes = db
        .prepare(
          `
            UPDATE user_agent_runtimes
            SET host_id = ?, runtime_type = ?, container_id = ?, image_version = ?, runtime_version = ?,
                schema_hash = ?, status = ?, last_error = ?, updated_at = ?
            WHERE user_id = ?
          `,
        )
        .run(
          runtime.hostId,
          runtime.runtimeType,
          runtime.containerId,
          runtime.imageVersion,
          runtime.runtimeVersion,
          runtime.schemaHash,
          runtime.status,
          runtime.lastError,
          runtime.updatedAt,
          runtime.userId,
        ).changes;
      if (changes === 0) {
        db.prepare(
          `
            INSERT INTO user_agent_runtimes (
              user_id, host_id, runtime_type, container_id, image_version, runtime_version,
              schema_hash, status, last_error, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
        ).run(
          runtime.userId,
          runtime.hostId,
          runtime.runtimeType,
          runtime.containerId,
          runtime.imageVersion,
          runtime.runtimeVersion,
          runtime.schemaHash,
          runtime.status,
          runtime.lastError,
          runtime.createdAt,
          runtime.updatedAt,
        );
      }
      return requiredRuntime(db, runtime.userId);
    },

    updateStatus(
      userId: number,
      status: RuntimeStatus,
      lastError: string | null = null,
    ): UserAgentRuntimeRecord | null {
      const normalizedUserId = positiveUserId(userId);
      const normalizedStatus = runtimeStatusSchema.parse(status);
      const normalizedError = nullableError(lastError);
      const result = db
        .prepare(
          "UPDATE user_agent_runtimes SET status = ?, last_error = ?, updated_at = ? WHERE user_id = ?",
        )
        .run(normalizedStatus, normalizedError, new Date().toISOString(), normalizedUserId);
      if (result.changes === 0) return null;
      return requiredRuntime(db, normalizedUserId);
    },

    deleteForUser(userId: number): boolean {
      const result = db
        .prepare("DELETE FROM user_agent_runtimes WHERE user_id = ?")
        .run(positiveUserId(userId));
      return result.changes > 0;
    },
  };
}

export const runtimeStore = {
  getByUserId(userId: number) {
    return createRuntimeStore(gatewayDatabase()).getByUserId(userId);
  },
  upsert(input: UserAgentRuntimeRecord) {
    return createRuntimeStore(gatewayDatabase()).upsert(input);
  },
  updateStatus(userId: number, status: RuntimeStatus, lastError: string | null = null) {
    return createRuntimeStore(gatewayDatabase()).updateStatus(userId, status, lastError);
  },
  deleteForUser(userId: number) {
    return createRuntimeStore(gatewayDatabase()).deleteForUser(userId);
  },
};

function requiredRuntime(db: DatabaseSync, userId: number): UserAgentRuntimeRecord {
  const row = db.prepare("SELECT * FROM user_agent_runtimes WHERE user_id = ?").get(userId);
  if (row === undefined) throw new Error(`Runtime for user ${userId} was not recorded`);
  return rowToRuntime(row);
}

function rowToRuntime(row: Record<string, unknown>): UserAgentRuntimeRecord {
  return userAgentRuntimeRecordSchema.parse({
    userId: Number(row.user_id),
    hostId: Number(row.host_id),
    runtimeType: row.runtime_type,
    containerId: row.container_id,
    imageVersion: row.image_version,
    runtimeVersion: row.runtime_version,
    schemaHash: row.schema_hash,
    status: row.status,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function positiveUserId(userId: number) {
  if (!Number.isInteger(userId) || userId <= 0)
    throw new Error("User ID must be a positive integer");
  return userId;
}

function nullableError(lastError: string | null) {
  if (lastError === null) return null;
  const text = lastError.trim();
  if (text === "") throw new Error("Runtime error must not be empty");
  return text;
}
