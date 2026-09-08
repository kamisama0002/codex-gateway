import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { freshMysqlTestDatabase } from "../../../../tests/mysql/helpers";
import type { GatewayDb } from "../storage/contracts";
import { decryptJson } from "../storage/crypto";
import { migrateMysqlGatewayDatabase } from "../storage/mysql-migrations";
import { bootstrapLegacyRuntimeNode } from "./runtime-node-bootstrap";
import { createRuntimeNodeStore } from "./runtime-node-store";
import { createRuntimePlacementStore } from "./runtime-placement-store";

const GIB = 1024 * 1024 * 1024;
const timestamp = "2026-09-08T00:00:00.000Z";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("legacy runtime node bootstrap", () => {
  it("creates node__default and backfills existing runtimes without changing runtime ids", async () => {
    vi.stubEnv("CODEX_GATEWAY_CONFIG_SECRET", "gateway-config-secret");
    const db = await freshMysqlTestDatabase();
    await migrateMysqlGatewayDatabase(db);
    await insertRuntime(db, 7, { memoryMiB: 2_048, cpuMillicores: 2_500, pidsLimit: 256 });
    await insertRuntime(db, 8);
    const identitySecret = "legacy-manager-secret";

    const result = await bootstrapLegacyRuntimeNode({
      db,
      defaultNodeId: "node__default",
      baseUrl: "http://agent-runtime-manager:8787",
      sharedSecret: "legacy-manager-secret",
      identitySecret,
      capacity: {
        cpuMillis: 16_000,
        memoryBytes: 64 * GIB,
        maxRuntimes: 30,
        minimumFreeDiskBytes: 20 * GIB,
      },
      defaultResources: { cpuMillis: 4_000, memoryBytes: 8 * GIB, pids: 1_024 },
      now: () => timestamp,
      workspaceKey: workspaceKeys(),
    });

    expect(result).toEqual({ nodeCreated: true, placementsBackfilled: 2 });
    const node = await createRuntimeNodeStore(db).get("node__default");
    expect(node).toMatchObject({
      baseUrl: "http://agent-runtime-manager:8787",
      schedulingState: "active",
      capacityCpuMillis: 16_000,
    });
    expect(decryptJson(node?.encryptedSharedSecret ?? "")).toEqual({
      secret: "legacy-manager-secret",
    });

    const placements = createRuntimePlacementStore(db);
    await expect(placements.getByUserId(7)).resolves.toMatchObject({
      runtimeId: runtimeId(identitySecret, 7),
      runtimeNodeId: "node__default",
      placementGeneration: 1,
      reservedCpuMillis: 2_500,
      reservedMemoryBytes: 2_048 * 1024 * 1024,
      reservedPids: 256,
    });
    await expect(placements.getByUserId(8)).resolves.toMatchObject({
      runtimeId: runtimeId(identitySecret, 8),
      reservedCpuMillis: 4_000,
      reservedMemoryBytes: 8 * GIB,
      reservedPids: 1_024,
    });
  });

  it("does not overwrite an existing node with changed legacy environment values", async () => {
    vi.stubEnv("CODEX_GATEWAY_CONFIG_SECRET", "gateway-config-secret");
    const db = await freshMysqlTestDatabase();
    await migrateMysqlGatewayDatabase(db);
    const initial = bootstrapInput(db);
    await bootstrapLegacyRuntimeNode(initial);

    const repeated = await bootstrapLegacyRuntimeNode({
      ...initial,
      baseUrl: "not-a-url",
      sharedSecret: "",
      workspaceKey: () => {
        throw new Error("workspace key must not be generated");
      },
    });

    expect(repeated).toEqual({ nodeCreated: false, placementsBackfilled: 0 });
    const node = await createRuntimeNodeStore(db).get("node__default");
    expect(node?.baseUrl).toBe("http://agent-runtime-manager:8787");
    expect(decryptJson(node?.encryptedSharedSecret ?? "")).toEqual({
      secret: "legacy-manager-secret",
    });
  });

  it("rejects a first rollout that would change existing runtime ids", async () => {
    vi.stubEnv("CODEX_GATEWAY_CONFIG_SECRET", "gateway-config-secret");
    const db = await freshMysqlTestDatabase();
    await migrateMysqlGatewayDatabase(db);
    await insertRuntime(db, 7);

    await expect(
      bootstrapLegacyRuntimeNode({
        ...bootstrapInput(db),
        identitySecret: "different-identity-secret",
      }),
    ).rejects.toMatchObject({ code: "runtime_identity_secret_mismatch" });
    await expect(createRuntimeNodeStore(db).list()).resolves.toEqual([]);
  });
});

function bootstrapInput(db: GatewayDb) {
  return {
    db,
    defaultNodeId: "node__default",
    baseUrl: "http://agent-runtime-manager:8787",
    sharedSecret: "legacy-manager-secret",
    identitySecret: "legacy-manager-secret",
    capacity: {
      cpuMillis: 16_000,
      memoryBytes: 64 * GIB,
      maxRuntimes: 30,
      minimumFreeDiskBytes: 20 * GIB,
    },
    defaultResources: { cpuMillis: 4_000, memoryBytes: 8 * GIB, pids: 1_024 },
    now: () => timestamp,
    workspaceKey: workspaceKeys(),
  };
}

async function insertRuntime(
  db: GatewayDb,
  userId: number,
  policy?: { memoryMiB: number; cpuMillicores: number; pidsLimit: number },
) {
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
      "0.153.4",
      "0.153.4",
      "schema-hash",
      "running",
      null,
      timestamp,
      timestamp,
    ],
  );
  if (policy !== undefined) {
    await db.execute(
      `INSERT INTO user_runtime_policies (
         user_id, tenant_id, policy_version, image_alias, memory_mib, cpu_millicores,
         pids_limit, source_issued_at, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        1,
        1,
        "stable",
        policy.memoryMiB,
        policy.cpuMillicores,
        policy.pidsLimit,
        timestamp,
        timestamp,
        timestamp,
      ],
    );
  }
}

function runtimeId(secret: string, userId: number) {
  const userHash = createHmac("sha256", secret)
    .update(`codex-runtime-user:${userId}`)
    .digest("hex");
  return `codex_${userHash.slice(0, 32)}`;
}

function workspaceKeys() {
  let next = 0;
  return () => `ws__${(++next).toString(16).padStart(32, "0")}`;
}
