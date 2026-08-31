import { DatabaseSync } from "node:sqlite";
import { MANAGED_RUNTIME_HOST_ID, migrateGatewayDatabase } from "../storage/migrations";
import { describe, expect, it } from "vitest";
import {
  serializeManagedRuntimeStatus,
  type UserAgentRuntimeRecord,
} from "@codex-gateway/agent-runtime-contracts";
import { createRuntimeStore } from "./runtime-store";

describe("runtimeStore", () => {
  it("never returns another user's runtime", () => {
    const db = migratedDatabase();
    const store = createRuntimeStore(db);

    store.upsert(runtimeFor(1, "container-a"));

    expect(store.getByUserId(2)).toBeNull();
  });

  it("updates the requested user's status without changing another user's runtime", () => {
    const db = migratedDatabase();
    const store = createRuntimeStore(db);
    store.upsert(runtimeFor(1, "container-a"));
    store.upsert(runtimeFor(2, "container-b"));

    const updated = store.updateStatus(1, "degraded", "health check failed");

    expect(updated).toMatchObject({
      userId: 1,
      status: "degraded",
      lastError: "health check failed",
    });
    expect(store.getByUserId(2)).toMatchObject({
      userId: 2,
      containerId: "container-b",
      status: "ready",
      lastError: null,
    });
  });

  it("deletes only the requested user's runtime", () => {
    const db = migratedDatabase();
    const store = createRuntimeStore(db);
    store.upsert(runtimeFor(1, "container-a"));
    store.upsert(runtimeFor(2, "container-b"));

    expect(store.deleteForUser(1)).toBe(true);
    expect(store.getByUserId(1)).toBeNull();
    expect(store.getByUserId(2)).toMatchObject({ userId: 2, containerId: "container-b" });
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

function migratedDatabase() {
  const db = new DatabaseSync(":memory:");
  migrateGatewayDatabase(db);
  db.prepare("INSERT INTO users (id, username, password_hash, role) VALUES (?, ?, ?, ?)").run(
    1,
    "first-user",
    "hash",
    "admin",
  );
  db.prepare("INSERT INTO users (id, username, password_hash, role) VALUES (?, ?, ?, ?)").run(
    2,
    "second-user",
    "hash",
    "user",
  );
  return db;
}

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
