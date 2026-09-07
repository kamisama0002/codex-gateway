import { beforeEach, describe, expect, it } from "vitest";
import { freshMysqlTestDatabase } from "../../../../tests/mysql/helpers";
import type { GatewayDb } from "../storage/contracts";
import { migrateMysqlGatewayDatabase } from "../storage/mysql-migrations";
import type { AssignRuntimePolicyInput } from "./runtime-policy";
import { createRuntimePolicyStore } from "./runtime-policy-store";

describe("runtimePolicyStore", () => {
  let db: GatewayDb;
  let store: ReturnType<typeof createRuntimePolicyStore>;

  beforeEach(async () => {
    db = await freshMysqlTestDatabase();
    await migrateMysqlGatewayDatabase(db);
    await db.execute(
      "INSERT INTO users (id, username, password_hash, role) VALUES (?, ?, ?, ?), (?, ?, ?, ?)",
      [1, "first-user", "hash", "admin", 2, "second-user", "hash", "user"],
    );
    store = createRuntimePolicyStore(db);
  });

  it("inserts the first assigned policy with CPU converted to millicores", async () => {
    const stored = await store.upsertIfNewer(policyInput(1));

    expect(stored).toEqual({
      userId: 1,
      tenantId: 10,
      policyVersion: 1,
      imageAlias: "stable",
      memoryMiB: 2048,
      cpuMillicores: 2250,
      pidsLimit: 256,
      sourceIssuedAt: "2026-09-04T00:00:00.000Z",
      createdAt: "2026-09-04T00:01:00.000Z",
      updatedAt: "2026-09-04T00:01:00.000Z",
    });
  });

  it("replaces a snapshot from a strictly newer Ticket and preserves creation time", async () => {
    await store.upsertIfNewer(policyInput(1));

    const updated = await store.upsertIfNewer(
      policyInput(1, {
        policy: policy({ imageAlias: "high-memory", memoryMiB: 4096, cpuCores: 3.5 }),
        sourceIssuedAt: "2026-09-04T00:02:00.000Z",
        now: "2026-09-04T00:03:00.000Z",
      }),
    );

    expect(updated).toMatchObject({
      imageAlias: "high-memory",
      memoryMiB: 4096,
      cpuMillicores: 3500,
      sourceIssuedAt: "2026-09-04T00:02:00.000Z",
      createdAt: "2026-09-04T00:01:00.000Z",
      updatedAt: "2026-09-04T00:03:00.000Z",
    });
  });

  it("treats equal source times as idempotent even if a retry carries different values", async () => {
    const first = await store.upsertIfNewer(policyInput(1));

    const retried = await store.upsertIfNewer(
      policyInput(1, {
        policy: policy({ imageAlias: "conflicting-retry", memoryMiB: 4096 }),
        now: "2026-09-04T00:05:00.000Z",
      }),
    );

    expect(retried).toEqual(first);
  });

  it("ignores an older Ticket exchanged after a newer Ticket", async () => {
    const newer = await store.upsertIfNewer(
      policyInput(1, {
        policy: policy({ imageAlias: "newer" }),
        sourceIssuedAt: "2026-09-04T00:10:00.000Z",
      }),
    );

    const result = await store.upsertIfNewer(
      policyInput(1, {
        policy: policy({ imageAlias: "older" }),
        sourceIssuedAt: "2026-09-04T00:09:00.000Z",
        now: "2026-09-04T00:11:00.000Z",
      }),
    );

    expect(result).toEqual(newer);
    await expect(store.getByUserId(1)).resolves.toEqual(newer);
  });

  it("ignores an offset-form timestamp that is chronologically older but sorts later", async () => {
    const current = await store.upsertIfNewer(policyInput(1));

    const result = await store.upsertIfNewer(
      policyInput(1, {
        policy: policy({ imageAlias: "older-offset" }),
        sourceIssuedAt: "2026-09-04T01:00:00.000+02:00",
        now: "2026-09-04T00:02:00.000Z",
      }),
    );

    expect(result).toEqual(current);
  });

  it("stores an offset-form newer timestamp in canonical UTC", async () => {
    await store.upsertIfNewer(policyInput(1));

    const result = await store.upsertIfNewer(
      policyInput(1, {
        policy: policy({ imageAlias: "newer-offset" }),
        sourceIssuedAt: "2026-09-04T03:00:00.000+02:00",
        now: "2026-09-04T01:01:00.000Z",
      }),
    );

    expect(result).toMatchObject({
      imageAlias: "newer-offset",
      sourceIssuedAt: "2026-09-04T01:00:00.000Z",
    });
  });

  it("treats offset-form representations of the same instant as idempotent", async () => {
    const current = await store.upsertIfNewer(policyInput(1));

    const result = await store.upsertIfNewer(
      policyInput(1, {
        policy: policy({ imageAlias: "equivalent-offset" }),
        sourceIssuedAt: "2026-09-04T02:00:00.000+02:00",
        now: "2026-09-04T00:02:00.000Z",
      }),
    );

    expect(result).toEqual(current);
  });

  it("never returns or changes another user's policy", async () => {
    await store.upsertIfNewer(policyInput(1));
    await store.upsertIfNewer(
      policyInput(2, { tenantId: 20, policy: policy({ imageAlias: "second" }) }),
    );

    await expect(store.getByUserId(1)).resolves.toMatchObject({
      userId: 1,
      tenantId: 10,
      imageAlias: "stable",
    });
    await expect(store.getByUserId(2)).resolves.toMatchObject({
      userId: 2,
      tenantId: 20,
      imageAlias: "second",
    });
  });

  it("rejects invalid user and tenant IDs", async () => {
    await expect(store.getByUserId(0)).rejects.toThrow("User ID");
    await expect(store.upsertIfNewer(policyInput(0))).rejects.toThrow();
    await expect(store.upsertIfNewer(policyInput(1, { tenantId: 0 }))).rejects.toThrow();
  });

  it("joins an existing transaction so callers can roll back the policy write", async () => {
    await expect(
      db.transaction(async (tx) => {
        await store.upsertIfNewer(policyInput(1), tx);
        throw new Error("roll back login");
      }),
    ).rejects.toThrow("roll back login");

    await expect(store.getByUserId(1)).resolves.toBeNull();
  });

  it("rejects malformed persisted rows instead of returning unchecked data", async () => {
    await db.execute(
      `INSERT INTO user_runtime_policies (
        user_id, tenant_id, policy_version, image_alias, memory_mib, cpu_millicores,
        pids_limit, source_issued_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        1,
        10,
        2,
        "stable",
        2048,
        2250,
        256,
        "2026-09-04T00:00:00.000Z",
        "2026-09-04T00:01:00.000Z",
        "2026-09-04T00:01:00.000Z",
      ],
    );

    await expect(store.getByUserId(1)).rejects.toThrow();
  });
});

function policyInput(
  userId: number,
  overrides: Partial<AssignRuntimePolicyInput> = {},
): AssignRuntimePolicyInput {
  return {
    userId,
    tenantId: 10,
    policy: policy(),
    sourceIssuedAt: "2026-09-04T00:00:00.000Z",
    now: "2026-09-04T00:01:00.000Z",
    ...overrides,
  };
}

function policy(overrides: Partial<AssignRuntimePolicyInput["policy"]> = {}) {
  return {
    version: 1 as const,
    imageAlias: "stable",
    memoryMiB: 2048,
    cpuCores: 2.25,
    pidsLimit: 256,
    ...overrides,
  };
}
