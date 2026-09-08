import type { GatewayDb } from "../storage/contracts";
import {
  runtimeNodeIdSchema,
  runtimeNodeRecordSchema,
  type RuntimeNodeRecord,
} from "./runtime-node-types";

export function createRuntimeNodeStore(db: GatewayDb) {
  return {
    async get(id: string): Promise<RuntimeNodeRecord | null> {
      const row = await db.one("SELECT * FROM runtime_nodes WHERE id = ?", [
        runtimeNodeIdSchema.parse(id),
      ]);
      return row === null ? null : rowToRuntimeNode(row);
    },

    async list(): Promise<RuntimeNodeRecord[]> {
      return (await db.many("SELECT * FROM runtime_nodes ORDER BY id ASC")).map(rowToRuntimeNode);
    },

    async listForUpdate(): Promise<RuntimeNodeRecord[]> {
      return (await db.many("SELECT * FROM runtime_nodes ORDER BY id ASC FOR UPDATE")).map(
        rowToRuntimeNode,
      );
    },

    async upsert(input: RuntimeNodeRecord): Promise<RuntimeNodeRecord> {
      const node = runtimeNodeRecordSchema.parse(input);
      await db.execute(
        `INSERT INTO runtime_nodes (
           id, name, base_url, encrypted_shared_secret, config_revision, scheduling_state,
           capacity_cpu_millis, capacity_memory_bytes, max_runtimes,
           minimum_free_disk_bytes, last_seen_at, last_error, health_json, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           name = VALUES(name),
           base_url = VALUES(base_url),
           encrypted_shared_secret = VALUES(encrypted_shared_secret),
           config_revision = VALUES(config_revision),
           scheduling_state = VALUES(scheduling_state),
           capacity_cpu_millis = VALUES(capacity_cpu_millis),
           capacity_memory_bytes = VALUES(capacity_memory_bytes),
           max_runtimes = VALUES(max_runtimes),
           minimum_free_disk_bytes = VALUES(minimum_free_disk_bytes),
           last_seen_at = VALUES(last_seen_at),
           last_error = VALUES(last_error),
           health_json = VALUES(health_json),
           updated_at = VALUES(updated_at)`,
        nodeValues(node),
      );
      return await requiredNode(db, node.id);
    },

    async updateHealth(
      id: string,
      health: Pick<RuntimeNodeRecord, "lastSeenAt" | "lastError" | "healthJson">,
    ): Promise<RuntimeNodeRecord> {
      const nodeId = runtimeNodeIdSchema.parse(id);
      const result = await db.execute(
        `UPDATE runtime_nodes
         SET last_seen_at = ?, last_error = ?, health_json = ?, updated_at = ?
         WHERE id = ?`,
        [health.lastSeenAt, health.lastError, health.healthJson, new Date().toISOString(), nodeId],
      );
      if (result.affectedRows !== 1) throw new Error("Runtime node not found");
      return await requiredNode(db, nodeId);
    },
  };
}

async function requiredNode(db: GatewayDb, id: string) {
  const row = await db.one("SELECT * FROM runtime_nodes WHERE id = ?", [id]);
  if (row === null) throw new Error("Runtime node not found");
  return rowToRuntimeNode(row);
}

function nodeValues(node: RuntimeNodeRecord) {
  return [
    node.id,
    node.name,
    new URL(node.baseUrl).origin,
    node.encryptedSharedSecret,
    node.configRevision,
    node.schedulingState,
    node.capacityCpuMillis,
    node.capacityMemoryBytes,
    node.maxRuntimes,
    node.minimumFreeDiskBytes,
    node.lastSeenAt,
    node.lastError,
    node.healthJson,
    node.createdAt,
    node.updatedAt,
  ] as const;
}

function rowToRuntimeNode(row: Record<string, unknown>): RuntimeNodeRecord {
  return runtimeNodeRecordSchema.parse({
    id: row.id,
    name: row.name,
    baseUrl: row.base_url,
    encryptedSharedSecret: row.encrypted_shared_secret,
    configRevision: Number(row.config_revision),
    schedulingState: row.scheduling_state,
    capacityCpuMillis: Number(row.capacity_cpu_millis),
    capacityMemoryBytes: Number(row.capacity_memory_bytes),
    maxRuntimes: Number(row.max_runtimes),
    minimumFreeDiskBytes: Number(row.minimum_free_disk_bytes),
    lastSeenAt: row.last_seen_at,
    lastError: row.last_error,
    healthJson: row.health_json,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}
