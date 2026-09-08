import { describe, expect, it } from "vitest";
import { freshMysqlTestDatabase } from "../../../../tests/mysql/helpers";
import { migrateMysqlGatewayDatabase } from "../storage/mysql-migrations";
import { createRuntimeNodeStore } from "./runtime-node-store";

const timestamp = "2026-09-08T00:00:00.000Z";

describe("runtime node store", () => {
  it("persists binary node identity, encrypted credentials, capacity, and health", async () => {
    const db = await freshMysqlTestDatabase();
    await migrateMysqlGatewayDatabase(db);
    const store = createRuntimeNodeStore(db);

    await store.upsert(node("node__primary"));
    await store.updateHealth("node__primary", {
      lastSeenAt: "2026-09-08T00:00:10.000Z",
      lastError: null,
      healthJson: JSON.stringify({ availableDiskBytes: 100 * 1024 * 1024 * 1024 }),
    });

    await expect(store.get("node__primary")).resolves.toMatchObject({
      id: "node__primary",
      encryptedSharedSecret: "v1$encrypted-primary",
      capacityCpuMillis: 32_000,
      lastSeenAt: "2026-09-08T00:00:10.000Z",
    });
    await expect(store.list()).resolves.toHaveLength(1);
  });

  it("lists nodes in stable id order", async () => {
    const db = await freshMysqlTestDatabase();
    await migrateMysqlGatewayDatabase(db);
    const store = createRuntimeNodeStore(db);

    await store.upsert(node("node__z"));
    await store.upsert(node("node__a"));
    await expect(store.list()).resolves.toEqual([
      expect.objectContaining({ id: "node__a" }),
      expect.objectContaining({ id: "node__z" }),
    ]);
  });
});

function node(id: string) {
  return {
    id,
    name: `Runtime ${id}`,
    baseUrl: `http://${id}.internal:8787`,
    encryptedSharedSecret: `v1$encrypted-${id.replace("node__", "")}`,
    configRevision: 1,
    schedulingState: "active" as const,
    capacityCpuMillis: 32_000,
    capacityMemoryBytes: 64 * 1024 * 1024 * 1024,
    maxRuntimes: 30,
    minimumFreeDiskBytes: 20 * 1024 * 1024 * 1024,
    lastSeenAt: timestamp,
    lastError: null,
    healthJson: JSON.stringify({ availableDiskBytes: 100 * 1024 * 1024 * 1024 }),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}
