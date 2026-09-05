import { describe, expect, it } from "vitest";
import { freshMysqlTestDatabase } from "../../../../tests/mysql/helpers";
import { migrateMysqlGatewayDatabase } from "./mysql-migrations";

describe("MySQL gateway migrations", () => {
  it("creates the complete schema once under concurrent runners", async () => {
    const db = await freshMysqlTestDatabase();

    await Promise.all([migrateMysqlGatewayDatabase(db), migrateMysqlGatewayDatabase(db)]);

    const tables = await db.many<{ table_name: string }>(
      "SELECT table_name AS table_name FROM information_schema.tables WHERE table_schema = DATABASE()",
    );
    expect(tables).toHaveLength(12);
    expect(tables.map((row) => row.table_name).sort()).toEqual(
      expect.arrayContaining([
        "users",
        "sessions",
        "user_configs",
        "tmux_monitors",
        "user_agent_runtimes",
        "agent_audit_events",
        "model_providers",
        "provider_models",
        "user_model_grants",
        "external_identities",
        "external_session_contexts",
        "schema_migrations",
      ]),
    );
    expect(await db.one("SELECT version, checksum FROM schema_migrations ORDER BY version DESC")).toEqual(
      expect.objectContaining({ version: 8 }),
    );
  });

  it("rejects a changed checksum for an applied migration", async () => {
    const db = await freshMysqlTestDatabase();
    await migrateMysqlGatewayDatabase(db);
    await db.execute("UPDATE schema_migrations SET checksum = ? WHERE version = ?", [
      "changed-checksum",
      1,
    ]);

    await expect(migrateMysqlGatewayDatabase(db)).rejects.toThrow("checksum");
  });

  it("uses unsigned ids, revision tracking, and active tmux uniqueness", async () => {
    const db = await freshMysqlTestDatabase();
    await migrateMysqlGatewayDatabase(db);

    expect(
      await db.one<{ column_type: string; column_default: string | null }>(
        "SELECT column_type AS column_type, column_default AS column_default FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'user_configs' AND column_name = 'revision'",
      ),
    ).toEqual({ column_type: "bigint unsigned", column_default: "1" });
    expect(
      await db.one<{ column_type: string }>(
        "SELECT column_type AS column_type FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'users' AND column_name = 'id'",
      ),
    ).toEqual({ column_type: "int unsigned" });
    expect(
      await db.one<{ index_name: string }>(
        "SELECT index_name AS index_name FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'tmux_monitors' AND index_name = 'uq_tmux_active_location'",
      ),
    ).toEqual({ index_name: "uq_tmux_active_location" });
    expect(
      await db.one<{ delete_rule: string }>(
        "SELECT delete_rule AS delete_rule FROM information_schema.referential_constraints WHERE constraint_schema = DATABASE() AND table_name = 'sessions' AND referenced_table_name = 'users'",
      ),
    ).toEqual({ delete_rule: "CASCADE" });

    const now = new Date().toISOString();
    await db.execute(
      "INSERT INTO users (id, username, password_hash, is_active, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [1, "migration-test-user", "password-hash", true, "user", now, now],
    );
    const monitorValues = [
      1,
      1,
      "session",
      "$1",
      1,
      0,
      "window",
      0,
      "%1",
      1,
      "initial",
      "last",
      "once",
      "active",
      now,
    ] as const;
    const insertMonitor = () =>
      db.execute(
        "INSERT INTO tmux_monitors (user_id, host_id, session_name, session_id, session_created, window_index, window_name, pane_index, pane_id, pane_pid, initial_command, last_command, mode, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        monitorValues,
      );
    await insertMonitor();
    await expect(insertMonitor()).rejects.toThrow("uq_tmux_active_location");
    await db.execute("DELETE FROM users WHERE id = ?", [1]);
    expect(await db.one("SELECT id FROM tmux_monitors WHERE user_id = ?", [1])).toBeNull();
  });
});
