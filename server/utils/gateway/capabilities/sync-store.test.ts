import { beforeEach, describe, expect, it } from "vitest";
import { freshMysqlTestDatabase } from "../../../../tests/mysql/helpers";
import type { GatewayDb } from "../storage/contracts";
import { migrateMysqlGatewayDatabase } from "../storage/mysql-migrations";
import { createCapabilitySyncStore, type CapabilitySyncStore } from "./sync-store";

describe("CapabilitySyncStore", () => {
  let db: GatewayDb;
  let store: CapabilitySyncStore;

  beforeEach(async () => {
    db = await freshMysqlTestDatabase();
    await migrateMysqlGatewayDatabase(db);
    await db.execute(
      "INSERT INTO users (id, username, password_hash, role) VALUES (?, ?, ?, ?), (?, ?, ?, ?)",
      [7, "operator-seven", "hash", "user", 8, "operator-eight", "hash", "user"],
    );
    store = createCapabilitySyncStore(db, () => "2026-09-07T00:00:00.000Z");
  });

  it("upserts one scoped row, increments attempts, and isolates users and projects", async () => {
    await store.begin(7, 10, "a".repeat(64));
    await store.finish(7, 10, {
      actualHash: "b".repeat(64),
      status: "succeeded",
      results: [],
      safeError: null,
    });
    await store.begin(7, 10, "c".repeat(64));
    await store.begin(7, 11, "d".repeat(64));
    await store.begin(8, 10, "e".repeat(64));

    expect(await store.get(7, 10)).toMatchObject({
      userId: 7,
      projectId: 10,
      desiredHash: "c".repeat(64),
      status: "running",
      attemptCount: 2,
    });
    expect(await store.list(7)).toHaveLength(2);
    expect(await store.list(8)).toEqual([expect.objectContaining({ userId: 8, projectId: 10 })]);
  });
});
