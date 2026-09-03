import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { createAuditStore } from "./audit-store";
import { migrateGatewayDatabase } from "../storage/migrations";

describe("auditStore", () => {
  it("records safe metadata and scopes user history to its subject", () => {
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
    const store = createAuditStore(db);

    store.record({
      actorUserId: 1,
      userId: 1,
      action: "runtime.start",
      outcome: "success",
      metadata: { runtimeId: "runtime-1", imageVersion: "image-1", attemptCount: 2 },
      createdAt: "2024-01-01T00:00:00.000Z",
    });
    store.record({
      actorUserId: 2,
      userId: 2,
      action: "runtime.stop",
      outcome: "failure",
      errorCode: "RUNTIME_UNAVAILABLE",
      metadata: { runtimeId: "runtime-2", status: "degraded" },
      createdAt: "2024-01-02T00:00:00.000Z",
    });

    expect(store.listForUser(1)).toEqual([
      expect.objectContaining({
        actorUserId: 1,
        userId: 1,
        action: "runtime.start",
        outcome: "success",
        errorCode: null,
        metadata: { runtimeId: "runtime-1", imageVersion: "image-1", attemptCount: 2 },
      }),
    ]);
    expect(store.listForAdmin()).toEqual([
      expect.objectContaining({ action: "runtime.stop", userId: 2 }),
      expect.objectContaining({ action: "runtime.start", userId: 1 }),
    ]);
  });

  it("rejects sensitive metadata keys before they can be persisted", () => {
    const db = new DatabaseSync(":memory:");
    migrateGatewayDatabase(db);
    const store = createAuditStore(db);

    expect(() =>
      store.record({
        userId: 1,
        action: "runtime.start",
        outcome: "failure",
        metadata: { accessToken: "do-not-store" },
      }),
    ).toThrow(/sensitive/i);
    expect(db.prepare("SELECT COUNT(*) AS count FROM agent_audit_events").get()).toMatchObject({ count: 0 });
  });
});
