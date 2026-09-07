import {
  serializeManagedRuntimeStatus,
  type UserAgentRuntimeRecord,
} from "@codex-gateway/agent-runtime-contracts";
import { beforeEach, describe, expect, it } from "vitest";
import { freshMysqlTestDatabase } from "../../../../tests/mysql/helpers";
import { MANAGED_RUNTIME_HOST_ID } from "~~/shared/runtime/managed-runtime";
import type { GatewayDb } from "../storage/contracts";
import { migrateMysqlGatewayDatabase } from "../storage/mysql-migrations";
import { createRuntimeStore } from "./runtime-store";

describe("runtimeStore", () => {
  let db: GatewayDb;
  let store: ReturnType<typeof createRuntimeStore>;

  beforeEach(async () => {
    db = await freshMysqlTestDatabase();
    await migrateMysqlGatewayDatabase(db);
    await db.execute(
      "INSERT INTO users (id, username, password_hash, role) VALUES (?, ?, ?, ?), (?, ?, ?, ?)",
      [1, "first-user", "hash", "admin", 2, "second-user", "hash", "user"],
    );
    store = createRuntimeStore(db);
  });

  it("never returns another user's runtime", async () => {
    await store.upsert(runtimeFor(1, "container-a"));

    await expect(store.getByUserId(2)).resolves.toBeNull();
  });

  it("lists all managed runtimes in stable user order for administration", async () => {
    await store.upsert(runtimeFor(2, "container-2"));
    await store.upsert(runtimeFor(1, "container-1"));

    expect((await store.list()).map((runtime) => runtime.userId)).toEqual([1, 2]);
  });

  it("upserts the requested user's status without changing ownership or creation time", async () => {
    await store.upsert(runtimeFor(1, "container-a"));
    await store.upsert(runtimeFor(2, "container-b"));

    const updated = await store.upsert({
      ...runtimeFor(1, "container-a"),
      status: "degraded",
      lastError: "health_check_failed",
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
    });

    expect(updated).toMatchObject({
      userId: 1,
      status: "degraded",
      lastError: "health_check_failed",
      createdAt: "2026-08-31T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
    });
    await expect(store.getByUserId(2)).resolves.toMatchObject({
      userId: 2,
      containerId: "container-b",
      status: "ready",
      lastError: null,
    });
  });

  it("deletes only the requested user's runtime", async () => {
    await store.upsert(runtimeFor(1, "container-a"));
    await store.upsert(runtimeFor(2, "container-b"));

    await expect(store.deleteForUser(1)).resolves.toBe(true);
    await expect(store.deleteForUser(1)).resolves.toBe(false);
    await expect(store.getByUserId(1)).resolves.toBeNull();
    await expect(store.getByUserId(2)).resolves.toMatchObject({
      userId: 2,
      containerId: "container-b",
    });
  });

  it("rolls back a runtime rejected by the user foreign key", async () => {
    await expect(store.upsert(runtimeFor(99, "container-missing-user"))).rejects.toMatchObject({
      code: "ER_NO_REFERENCED_ROW_2",
    });

    expect(
      await db.one<{ count: number }>("SELECT COUNT(*) AS count FROM user_agent_runtimes"),
    ).toMatchObject({ count: 0 });
  });

  it("serializes runtime status without its container ID", () => {
    const runtime = runtimeFor(1, "container-a");

    expect(serializeManagedRuntimeStatus(runtime)).toEqual({
      userId: 1,
      hostId: MANAGED_RUNTIME_HOST_ID,
      runtimeType: "codex-app-server",
      imageVersion: "codex:1.0.0",
      runtimeVersion: "1.0.0",
      schemaHash: "schema-1",
      status: "ready",
      lastError: null,
      createdAt: "2026-08-31T00:00:00.000Z",
      updatedAt: "2026-08-31T00:00:00.000Z",
    });
  });
});

function runtimeFor(userId: number, containerId: string): UserAgentRuntimeRecord {
  return {
    userId,
    hostId: MANAGED_RUNTIME_HOST_ID,
    runtimeType: "codex-app-server",
    containerId,
    imageVersion: "codex:1.0.0",
    runtimeVersion: "1.0.0",
    schemaHash: "schema-1",
    status: "ready",
    lastError: null,
    createdAt: "2026-08-31T00:00:00.000Z",
    updatedAt: "2026-08-31T00:00:00.000Z",
  };
}
