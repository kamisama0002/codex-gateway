import { describe, expect, it } from "vitest";
import { freshMysqlTestDatabase } from "../../../../tests/mysql/helpers";
import type { GatewayDb } from "../storage/contracts";
import { migrateMysqlGatewayDatabase } from "../storage/mysql-migrations";
import { createRuntimeNodeStore } from "./runtime-node-store";
import { createRuntimePlacementStore } from "./runtime-placement-store";

const GIB = 1024 * 1024 * 1024;
const timestamp = "2026-09-08T00:00:00.000Z";

describe("runtime placement store", () => {
  it("returns null when the user has no runtime record", async () => {
    const db = await freshMysqlTestDatabase();
    await migrateMysqlGatewayDatabase(db);
    const store = createRuntimePlacementStore(db);

    await expect(store.getByUserId(99)).resolves.toBeNull();
  });

  it("creates one durable placement for two concurrent first starts", async () => {
    const db = await databaseWithRuntime(7);
    const nodes = createRuntimeNodeStore(db);
    await nodes.upsert(node("node__b"));
    await nodes.upsert(node("node__a"));
    const store = createRuntimePlacementStore(db, {
      now: () => timestamp,
      freshnessMs: 30_000,
    });
    const request = placementRequest(7);

    const [left, right] = await Promise.all([
      store.ensurePlacement(request),
      store.ensurePlacement(request),
    ]);

    expect(left).toEqual(right);
    expect(left.runtimeNodeId).toBe("node__a");
    expect(
      await db.many("SELECT user_id FROM user_agent_runtimes WHERE user_id = ?", [7]),
    ).toHaveLength(1);
  });

  it("keeps the existing placement when another node later has more capacity", async () => {
    const db = await databaseWithRuntime(8);
    const nodes = createRuntimeNodeStore(db);
    await nodes.upsert(node("node__a"));
    await nodes.upsert(node("node__b", { capacityCpuMillis: 10_000 }));
    const store = createRuntimePlacementStore(db, {
      now: () => timestamp,
      freshnessMs: 30_000,
    });
    const original = await store.ensurePlacement(placementRequest(8));
    await nodes.upsert(node("node__b", { capacityCpuMillis: 64_000 }));

    const retained = await store.ensurePlacement({
      ...placementRequest(8),
      runtimeId: "codex_ffffffffffffffffffffffffffffffff",
      workspaceKey: "ws__ffffffffffffffffffffffffffffffff",
    });

    expect(retained).toEqual(original);
    expect(retained.runtimeNodeId).toBe("node__a");
  });
});

async function databaseWithRuntime(userId: number): Promise<GatewayDb> {
  const db = await freshMysqlTestDatabase();
  await migrateMysqlGatewayDatabase(db);
  await db.execute(
    "INSERT INTO users (id, username, password_hash, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    [userId, `runtime-user-${userId}`, "password-hash", "user", timestamp, timestamp],
  );
  await db.execute(
    `INSERT INTO user_agent_runtimes (
       user_id, host_id, runtime_type, container_id, image_version, runtime_version,
       schema_hash, status, last_error, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      userId,
      2_000_000_000,
      "codex-app-server",
      null,
      "pending",
      "pending",
      "pending",
      "provisioning",
      null,
      timestamp,
      timestamp,
    ],
  );
  return db;
}

function node(id: string, overrides: { capacityCpuMillis?: number } = {}) {
  return {
    id,
    name: `Runtime ${id}`,
    baseUrl: `http://${id}.internal:8787`,
    encryptedSharedSecret: `v1$encrypted-${id}`,
    configRevision: 1,
    schedulingState: "active" as const,
    capacityCpuMillis: overrides.capacityCpuMillis ?? 32_000,
    capacityMemoryBytes: 64 * GIB,
    maxRuntimes: 30,
    minimumFreeDiskBytes: 20 * GIB,
    lastSeenAt: timestamp,
    lastError: null,
    healthJson: JSON.stringify({ availableDiskBytes: 100 * GIB }),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function placementRequest(userId: number) {
  const suffix = userId.toString(16).padStart(32, "0");
  return {
    userId,
    runtimeId: `codex_${suffix}`,
    workspaceKey: `ws__${suffix}`,
    reservedCpuMillis: 5_000,
    reservedMemoryBytes: 10 * GIB,
    reservedPids: 1_024,
  };
}
