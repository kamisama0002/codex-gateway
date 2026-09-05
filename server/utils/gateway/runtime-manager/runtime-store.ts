import {
  userAgentRuntimeRecordSchema,
  type UserAgentRuntimeRecord,
} from "@codex-gateway/agent-runtime-contracts";
import { MANAGED_RUNTIME_HOST_ID } from "~~/shared/runtime/managed-runtime";
import type { GatewayDb } from "../storage/contracts";
import { gatewayMysqlDatabase } from "../storage/mysql-database";

export function createRuntimeStore(db: GatewayDb) {
  return {
    async getByUserId(userId: number): Promise<UserAgentRuntimeRecord | null> {
      const row = await db.one("SELECT * FROM user_agent_runtimes WHERE user_id = ?", [
        positiveUserId(userId),
      ]);
      return row === null ? null : rowToRuntime(row);
    },

    async list(): Promise<UserAgentRuntimeRecord[]> {
      const rows = await db.many("SELECT * FROM user_agent_runtimes ORDER BY user_id ASC");
      return rows.map(rowToRuntime);
    },

    async upsert(input: UserAgentRuntimeRecord): Promise<UserAgentRuntimeRecord> {
      const runtime = userAgentRuntimeRecordSchema.parse(input);
      if (runtime.hostId !== MANAGED_RUNTIME_HOST_ID) {
        throw new Error("Managed runtime host ID is invalid");
      }
      return await db.transaction(async (tx) => {
        await tx.execute(
          `INSERT INTO user_agent_runtimes (
             user_id, host_id, runtime_type, container_id, image_version, runtime_version,
             schema_hash, status, last_error, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             host_id = VALUES(host_id),
             runtime_type = VALUES(runtime_type),
             container_id = VALUES(container_id),
             image_version = VALUES(image_version),
             runtime_version = VALUES(runtime_version),
             schema_hash = VALUES(schema_hash),
             status = VALUES(status),
             last_error = VALUES(last_error),
             updated_at = VALUES(updated_at)`,
          [
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
          ],
        );
        return await requiredRuntime(tx, runtime.userId);
      });
    },

    async deleteForUser(userId: number): Promise<boolean> {
      const result = await db.execute("DELETE FROM user_agent_runtimes WHERE user_id = ?", [
        positiveUserId(userId),
      ]);
      return result.affectedRows > 0;
    },
  };
}

export const runtimeStore = {
  getByUserId(userId: number) {
    return createRuntimeStore(gatewayMysqlDatabase()).getByUserId(userId);
  },
  list() {
    return createRuntimeStore(gatewayMysqlDatabase()).list();
  },
  upsert(input: UserAgentRuntimeRecord) {
    return createRuntimeStore(gatewayMysqlDatabase()).upsert(input);
  },
  deleteForUser(userId: number) {
    return createRuntimeStore(gatewayMysqlDatabase()).deleteForUser(userId);
  },
};

async function requiredRuntime(db: GatewayDb, userId: number): Promise<UserAgentRuntimeRecord> {
  const row = await db.one("SELECT * FROM user_agent_runtimes WHERE user_id = ?", [userId]);
  if (row === null) throw new Error(`Runtime for user ${userId} was not recorded`);
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
  if (!Number.isInteger(userId) || userId <= 0) {
    throw new Error("User ID must be a positive integer");
  }
  return userId;
}
