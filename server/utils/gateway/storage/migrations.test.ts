import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { MANAGED_RUNTIME_HOST_ID } from "~~/shared/runtime/managed-runtime";
import { migrateGatewayDatabase } from "./migrations";

describe("migrateGatewayDatabase", () => {
  it("adds user roles and the per-user runtime table idempotently", () => {
    const db = new DatabaseSync(":memory:");

    migrateGatewayDatabase(db);
    migrateGatewayDatabase(db);

    const userColumns = db.prepare("PRAGMA table_info(users)").all();
    expect(userColumns.some((column) => column.name === "role")).toBe(true);
    expect(
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'user_agent_runtimes'",
        )
        .get(),
    ).toBeTruthy();
    db.prepare("INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)").run(
      "runtime-owner",
      "hash",
      "user",
    );
    db.prepare(
      `
        INSERT INTO user_agent_runtimes (
          user_id, runtime_type, image_version, runtime_version, schema_hash, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
    ).run(
      1,
      "codex-app-server",
      "image-1",
      "runtime-1",
      "schema-1",
      "absent",
      "2024-01-01T00:00:00.000Z",
      "2024-01-01T00:00:00.000Z",
    );
    expect(
      db.prepare("SELECT host_id FROM user_agent_runtimes WHERE user_id = ?").get(1),
    ).toMatchObject({
      host_id: MANAGED_RUNTIME_HOST_ID,
    });
    expect(db.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get()).toMatchObject({
      count: 7,
    });
    expect(MANAGED_RUNTIME_HOST_ID).toBe(2_000_000_000);
  });

  it("promotes only the oldest active legacy user when no administrator exists", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    db.prepare(
      "INSERT INTO users (username, password_hash, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    ).run("disabled", "hash", 0, "2024-01-01T00:00:00.000Z", "2024-01-01T00:00:00.000Z");
    db.prepare(
      "INSERT INTO users (username, password_hash, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    ).run("first-active", "hash", 1, "2024-02-01T00:00:00.000Z", "2024-02-01T00:00:00.000Z");
    db.prepare(
      "INSERT INTO users (username, password_hash, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    ).run("later-active", "hash", 1, "2024-03-01T00:00:00.000Z", "2024-03-01T00:00:00.000Z");

    migrateGatewayDatabase(db);

    expect(db.prepare("SELECT username, role FROM users ORDER BY id").all()).toEqual([
      { username: "disabled", role: "user" },
      { username: "first-active", role: "admin" },
      { username: "later-active", role: "user" },
    ]);
  });
});
