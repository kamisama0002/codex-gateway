import { beforeEach, describe, expect, it } from "vitest";
import { freshMysqlTestDatabase } from "../../../../tests/mysql/helpers";
import type { GatewayDb } from "../storage/contracts";
import { migrateMysqlGatewayDatabase } from "../storage/mysql-migrations";
import { createAuditStore } from "./audit-store";

describe("auditStore", () => {
  let db: GatewayDb;
  let store: ReturnType<typeof createAuditStore>;

  beforeEach(async () => {
    db = await freshMysqlTestDatabase();
    await migrateMysqlGatewayDatabase(db);
    await db.execute(
      "INSERT INTO users (id, username, password_hash, role) VALUES (?, ?, ?, ?), (?, ?, ?, ?)",
      [1, "first-user", "hash", "admin", 2, "second-user", "hash", "user"],
    );
    store = createAuditStore(db);
  });

  it("records safe metadata and scopes user history to its subject in newest-first order", async () => {
    await store.record({
      actorUserId: 1,
      userId: 1,
      action: "runtime.start",
      outcome: "success",
      metadata: { runtimeId: "runtime-1", imageVersion: "image-1", attemptCount: 2 },
      createdAt: "2024-01-01T00:00:00.000Z",
    });
    await store.record({
      actorUserId: 2,
      userId: 2,
      action: "runtime.stop",
      outcome: "failure",
      errorCode: "RUNTIME_UNAVAILABLE",
      metadata: { runtimeId: "runtime-2", status: "degraded" },
      createdAt: "2024-01-02T00:00:00.000Z",
    });
    await store.record({
      actorUserId: 1,
      userId: 1,
      action: "runtime.restart",
      outcome: "success",
      metadata: { runtimeId: "runtime-1", status: "ready" },
      createdAt: "2024-01-02T00:00:00.000Z",
    });

    expect(await store.listForUser(1)).toEqual([
      expect.objectContaining({
        actorUserId: 1,
        userId: 1,
        action: "runtime.restart",
        outcome: "success",
        errorCode: null,
        metadata: { runtimeId: "runtime-1", status: "ready" },
      }),
      expect.objectContaining({
        actorUserId: 1,
        userId: 1,
        action: "runtime.start",
        outcome: "success",
        errorCode: null,
        metadata: { runtimeId: "runtime-1", imageVersion: "image-1", attemptCount: 2 },
      }),
    ]);
    expect((await store.listForAdmin()).map((event) => event.action)).toEqual([
      "runtime.restart",
      "runtime.stop",
      "runtime.start",
    ]);
  });

  it("rejects sensitive metadata synchronously before starting persistence", async () => {
    expect(() =>
      store.record({
        userId: 1,
        action: "runtime.start",
        outcome: "failure",
        metadata: { accessToken: "do-not-store" },
      }),
    ).toThrow(/sensitive/i);
    expect(
      await db.one<{ count: number }>("SELECT COUNT(*) AS count FROM agent_audit_events"),
    ).toMatchObject({ count: 0 });
  });

  it("rolls back an event rejected by the user foreign key", async () => {
    await expect(
      store.record({
        actorUserId: 1,
        userId: 99,
        action: "runtime.start",
        outcome: "failure",
        errorCode: "runtime_not_found",
        metadata: { userId: 99, runtimeStatus: "absent" },
      }),
    ).rejects.toMatchObject({ code: "ER_NO_REFERENCED_ROW_2" });

    expect(
      await db.one<{ count: number }>("SELECT COUNT(*) AS count FROM agent_audit_events"),
    ).toMatchObject({ count: 0 });
  });
});
