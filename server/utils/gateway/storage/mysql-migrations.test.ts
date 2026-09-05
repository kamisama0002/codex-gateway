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
    expect(
      await db.one("SELECT version, checksum FROM schema_migrations ORDER BY version DESC"),
    ).toEqual(expect.objectContaining({ version: 8 }));
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

  it("keeps identifier and enum comparisons binary and populates UTC timestamp defaults", async () => {
    const db = await freshMysqlTestDatabase();
    await migrateMysqlGatewayDatabase(db);
    const now = new Date().toISOString();

    await db.execute("INSERT INTO users (username, password_hash) VALUES (?, ?), (?, ?)", [
      "binary-user",
      "password-hash",
      "BINARY-USER",
      "password-hash",
    ]);
    await db.execute(
      "INSERT INTO model_providers (id, name, base_url, wire_api, encrypted_api_key, request_timeout_ms, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?, ?, ?)",
      [
        "provider",
        "Provider",
        "https://example.test",
        "responses",
        "encrypted",
        30_000,
        now,
        now,
        "PROVIDER",
        "Provider uppercase",
        "https://example.test",
        "responses",
        "encrypted",
        30_000,
        now,
        now,
      ],
    );
    await db.execute(
      "INSERT INTO provider_models (provider_id, model_id, display_name, capabilities_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?)",
      [
        "provider",
        "model",
        "Model",
        "{}",
        now,
        now,
        "provider",
        "MODEL",
        "Model uppercase",
        "{}",
        now,
        now,
      ],
    );
    await db.execute(
      "INSERT INTO external_identities (provider, external_subject, user_id, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?)",
      [
        "dataops",
        "subject",
        1,
        "Subject",
        now,
        now,
        "dataops",
        "SUBJECT",
        2,
        "Subject uppercase",
        now,
        now,
      ],
    );
    await db.execute("INSERT INTO user_configs (user_id, encrypted_config_json) VALUES (?, ?)", [
      1,
      "encrypted-config",
    ]);
    await db.execute("INSERT INTO sessions (user_id, token_hash, expires_at) VALUES (?, ?, ?)", [
      1,
      "token-hash",
      "2030-01-01T00:00:00.000Z",
    ]);

    expect(await db.many("SELECT username FROM users ORDER BY username")).toHaveLength(2);
    expect(await db.many("SELECT id FROM model_providers ORDER BY id")).toHaveLength(2);
    expect(
      await db.many("SELECT model_id FROM provider_models WHERE provider_id = ?", ["provider"]),
    ).toHaveLength(2);
    expect(
      await db.many("SELECT external_subject FROM external_identities WHERE provider = ?", [
        "dataops",
      ]),
    ).toHaveLength(2);
    await expect(
      db.execute(
        "INSERT INTO tmux_monitors (user_id, host_id, session_name, session_id, session_created, window_index, window_name, pane_index, pane_id, pane_pid, initial_command, last_command, mode, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [
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
          "ACTIVE",
          now,
        ],
      ),
    ).rejects.toThrow();

    const user = await db.one<{ created_at: string; updated_at: string }>(
      "SELECT created_at, updated_at FROM users WHERE id = ?",
      [1],
    );
    const session = await db.one<{ created_at: string; last_seen_at: string }>(
      "SELECT created_at, last_seen_at FROM sessions WHERE token_hash = ?",
      ["token-hash"],
    );
    const config = await db.one<{ updated_at: string }>(
      "SELECT updated_at FROM user_configs WHERE user_id = ?",
      [1],
    );
    for (const timestamp of [
      user?.created_at,
      user?.updated_at,
      session?.created_at,
      session?.last_seen_at,
      config?.updated_at,
    ]) {
      expect(timestamp).toMatch(/Z$/);
      expect(Number.isNaN(Date.parse(timestamp ?? ""))).toBe(false);
    }
  });

  it("records migrations after their DDL was applied before the migration row", async () => {
    const db = await freshMysqlTestDatabase();
    await migrateMysqlGatewayDatabase(db);
    await db.execute("DELETE FROM schema_migrations WHERE version IN (?, ?)", [2, 7]);

    await migrateMysqlGatewayDatabase(db);

    expect(
      await db.many<{ version: number; count: number }>(
        "SELECT version, COUNT(*) AS count FROM schema_migrations GROUP BY version ORDER BY version",
      ),
    ).toEqual([
      { version: 1, count: 1 },
      { version: 2, count: 1 },
      { version: 3, count: 1 },
      { version: 4, count: 1 },
      { version: 5, count: 1 },
      { version: 6, count: 1 },
      { version: 7, count: 1 },
      { version: 8, count: 1 },
    ]);
  });
});
