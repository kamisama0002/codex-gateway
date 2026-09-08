import { z } from "zod";
import type { GatewayDb } from "../storage/contracts";
import { createRuntimeNodeStore } from "./runtime-node-store";
import {
  RuntimePlacementError,
  scheduleRuntimeNode,
  type RuntimeNodeReservation,
} from "./runtime-node-scheduler";
import { runtimePlacementRecordSchema, type RuntimePlacementRecord } from "./runtime-node-types";

const placementRequestSchema = runtimePlacementRecordSchema
  .omit({ runtimeNodeId: true, placementGeneration: true })
  .strict();
const schedulingHealthSchema = z.looseObject({
  availableDiskBytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
});

export function createRuntimePlacementStore(
  db: GatewayDb,
  options: { now?: () => string; freshnessMs?: number } = {},
) {
  const now = options.now ?? (() => new Date().toISOString());
  const freshnessMs = options.freshnessMs ?? 30_000;
  return {
    async getByUserId(userId: number): Promise<RuntimePlacementRecord | null> {
      return await placementForUser(db, positiveUserId(userId), false, true);
    },

    async ensurePlacement(input: z.infer<typeof placementRequestSchema>) {
      const request = placementRequestSchema.parse(input);
      return await db.transaction(
        async (tx) => {
          const existing = await placementForUser(tx, request.userId, true);
          if (existing !== null) return existing;
          const nodes = await createRuntimeNodeStore(tx).listForUpdate();
          const reservations = await placementReservations(tx);
          const selected = scheduleRuntimeNode({
            requested: {
              cpuMillis: request.reservedCpuMillis,
              memoryBytes: request.reservedMemoryBytes,
              pids: request.reservedPids,
            },
            nodes: nodes.map((node) => ({
              node,
              availableDiskBytes: availableDiskBytes(node.healthJson),
            })),
            reservations,
            nowMs: Date.parse(now()),
            freshnessMs,
          });
          const result = await tx.execute(
            `UPDATE user_agent_runtimes
             SET runtime_id = ?, runtime_node_id = ?, placement_generation = 1,
                 workspace_key = ?, reserved_cpu_millis = ?, reserved_memory_bytes = ?,
                 reserved_pids = ?
             WHERE user_id = ? AND runtime_node_id IS NULL`,
            [
              request.runtimeId,
              selected.id,
              request.workspaceKey,
              request.reservedCpuMillis,
              request.reservedMemoryBytes,
              request.reservedPids,
              request.userId,
            ],
          );
          if (result.affectedRows !== 1) {
            const committed = await placementForUser(tx, request.userId, false);
            if (committed !== null) return committed;
            throw new RuntimePlacementError("runtime_node_capacity_unavailable");
          }
          const placement = await placementForUser(tx, request.userId, false);
          if (placement === null) throw new Error("Runtime placement was not persisted");
          return placement;
        },
        { isolationLevel: "serializable" },
      );
    },
  };
}

async function placementForUser(
  db: GatewayDb,
  userId: number,
  lock: boolean,
  missingRuntimeAsNull = false,
) {
  const row = await db.one(
    `SELECT user_id, runtime_id, runtime_node_id, placement_generation, workspace_key,
            reserved_cpu_millis, reserved_memory_bytes, reserved_pids
     FROM user_agent_runtimes
     WHERE user_id = ?${lock ? " FOR UPDATE" : ""}`,
    [positiveUserId(userId)],
  );
  if (row === null) {
    if (missingRuntimeAsNull) return null;
    throw new Error("Runtime for user was not recorded");
  }
  const values = [
    row.runtime_id,
    row.runtime_node_id,
    row.placement_generation,
    row.workspace_key,
    row.reserved_cpu_millis,
    row.reserved_memory_bytes,
    row.reserved_pids,
  ];
  if (values.every((value) => value === null)) return null;
  return runtimePlacementRecordSchema.parse({
    userId: Number(row.user_id),
    runtimeId: row.runtime_id,
    runtimeNodeId: row.runtime_node_id,
    placementGeneration: Number(row.placement_generation),
    workspaceKey: row.workspace_key,
    reservedCpuMillis: Number(row.reserved_cpu_millis),
    reservedMemoryBytes: Number(row.reserved_memory_bytes),
    reservedPids: Number(row.reserved_pids),
  });
}

async function placementReservations(db: GatewayDb) {
  const rows = await db.many(
    `SELECT runtime_node_id,
            COALESCE(SUM(reserved_cpu_millis), 0) AS cpu_millis,
            COALESCE(SUM(reserved_memory_bytes), 0) AS memory_bytes,
            COUNT(*) AS runtime_count
     FROM user_agent_runtimes
     WHERE runtime_node_id IS NOT NULL
     GROUP BY runtime_node_id
     ORDER BY runtime_node_id`,
  );
  return new Map<string, RuntimeNodeReservation>(
    rows.map((row) => [
      String(row.runtime_node_id),
      {
        cpuMillis: Number(row.cpu_millis),
        memoryBytes: Number(row.memory_bytes),
        runtimes: Number(row.runtime_count),
      },
    ]),
  );
}

function availableDiskBytes(healthJson: string | null) {
  if (healthJson === null) return 0;
  try {
    return schedulingHealthSchema.parse(JSON.parse(healthJson)).availableDiskBytes;
  } catch {
    return 0;
  }
}

function positiveUserId(userId: number) {
  if (!Number.isInteger(userId) || userId <= 0) throw new Error("User ID must be positive");
  return userId;
}
