import { describe, expect, it } from "vitest";
import { freshMysqlTestDatabase } from "../../../../tests/mysql/helpers";
import { createCapabilityStore } from "../capabilities/store";
import { migrateMysqlGatewayDatabase } from "./mysql-migrations";

describe("MySQL gateway migrations", () => {
  it("creates the complete schema once under concurrent runners", async () => {
    const db = await freshMysqlTestDatabase();

    await Promise.all([migrateMysqlGatewayDatabase(db), migrateMysqlGatewayDatabase(db)]);

    const tables = await db.many<{ table_name: string }>(
      "SELECT table_name AS table_name FROM information_schema.tables WHERE table_schema = DATABASE()",
    );
    expect(tables).toHaveLength(22);
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
        "capability_definitions",
        "capability_artifacts",
        "capability_assignments",
        "capability_syncs",
        "credentials",
        "credential_oauth_states",
        "user_runtime_policies",
        "platform_integrations",
        "integration_pairing_codes",
        "runtime_nodes",
        "schema_migrations",
      ]),
    );
    expect(
      await db.one("SELECT version, checksum FROM schema_migrations ORDER BY version DESC"),
    ).toEqual(expect.objectContaining({ version: 18 }));
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

  it("creates the user runtime policy snapshot table with tenant lookup and user cascade", async () => {
    const db = await freshMysqlTestDatabase();
    await migrateMysqlGatewayDatabase(db);

    expect(
      await db.many<{ column_name: string; column_type: string; is_nullable: string }>(
        "SELECT column_name AS column_name, column_type AS column_type, is_nullable AS is_nullable FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'user_runtime_policies' ORDER BY ordinal_position",
      ),
    ).toEqual([
      { column_name: "user_id", column_type: "int unsigned", is_nullable: "NO" },
      { column_name: "tenant_id", column_type: "int unsigned", is_nullable: "NO" },
      { column_name: "policy_version", column_type: "int unsigned", is_nullable: "NO" },
      { column_name: "image_alias", column_type: "varchar(64)", is_nullable: "NO" },
      { column_name: "memory_mib", column_type: "int unsigned", is_nullable: "NO" },
      { column_name: "cpu_millicores", column_type: "int unsigned", is_nullable: "NO" },
      { column_name: "pids_limit", column_type: "int unsigned", is_nullable: "NO" },
      { column_name: "source_issued_at", column_type: "varchar(32)", is_nullable: "NO" },
      { column_name: "created_at", column_type: "varchar(32)", is_nullable: "NO" },
      { column_name: "updated_at", column_type: "varchar(32)", is_nullable: "NO" },
    ]);
    await expect(
      db.one<{ column_name: string }>(
        "SELECT column_name AS column_name FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'user_runtime_policies' AND index_name = 'PRIMARY'",
      ),
    ).resolves.toEqual({ column_name: "user_id" });
    await expect(
      db.one<{ index_name: string; columns: string }>(
        "SELECT index_name AS index_name, GROUP_CONCAT(column_name ORDER BY seq_in_index) AS columns FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'user_runtime_policies' AND index_name = 'idx_user_runtime_policies_tenant' GROUP BY index_name",
      ),
    ).resolves.toEqual({
      index_name: "idx_user_runtime_policies_tenant",
      columns: "tenant_id,user_id",
    });
    await expect(
      db.one<{ delete_rule: string }>(
        "SELECT delete_rule AS delete_rule FROM information_schema.referential_constraints WHERE constraint_schema = DATABASE() AND table_name = 'user_runtime_policies' AND referenced_table_name = 'users'",
      ),
    ).resolves.toEqual({ delete_rule: "CASCADE" });
    await expect(
      db.one<{ table_collation: string }>(
        "SELECT table_collation AS table_collation FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'user_runtime_policies'",
      ),
    ).resolves.toEqual({ table_collation: "utf8mb4_0900_bin" });
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
      { version: 9, count: 1 },
      { version: 10, count: 1 },
      { version: 11, count: 1 },
      { version: 12, count: 1 },
      { version: 13, count: 1 },
      { version: 14, count: 1 },
      { version: 15, count: 1 },
      { version: 16, count: 1 },
      { version: 17, count: 1 },
      { version: 18, count: 1 },
    ]);
  });

  it("assigns the default web search capability to users that predate migration 13", async () => {
    const db = await freshMysqlTestDatabase();
    await migrateMysqlGatewayDatabase(db);
    await db.execute("DELETE FROM schema_migrations WHERE version = ?", [13]);
    await db.execute("DELETE FROM capability_assignments WHERE capability_id = ?", [
      "org__web_search",
    ]);
    await db.execute("DELETE FROM capability_definitions WHERE id = ?", ["org__web_search"]);
    await db.execute("INSERT INTO users (username, password_hash) VALUES (?, ?)", [
      "existing-user",
      "password-hash",
    ]);

    await migrateMysqlGatewayDatabase(db);

    await expect(
      db.one(
        `SELECT a.capability_id
         FROM capability_assignments a
         JOIN users u ON u.id = a.user_id
         WHERE u.username = ?`,
        ["existing-user"],
      ),
    ).resolves.toEqual({ capability_id: "org__web_search" });
  });

  it("assigns the default browser capability to users that predate migration 14", async () => {
    const db = await freshMysqlTestDatabase();
    await migrateMysqlGatewayDatabase(db);
    await db.execute("DELETE FROM schema_migrations WHERE version IN (?, ?)", [14, 18]);
    await db.execute("DELETE FROM capability_assignments WHERE capability_id = ?", [
      "org__browser",
    ]);
    await db.execute("DELETE FROM capability_definitions WHERE id = ?", ["org__browser"]);
    await db.execute("INSERT INTO users (username, password_hash) VALUES (?, ?)", [
      "browser-user",
      "password-hash",
    ]);

    await migrateMysqlGatewayDatabase(db);

    await expect(createCapabilityStore(db).get("org__browser")).resolves.toMatchObject({
      kind: "mcp",
      source: { type: "builtin", locator: "playwright-mcp" },
      config: {
        transport: "stdio",
        command: "playwright-mcp",
        args: [
          "--no-sandbox",
          "--cdp-endpoint",
          "http://127.0.0.1:9222",
          "--output-dir",
          "/workspace/.agent/browser",
          "--caps",
          "vision,pdf",
        ],
      },
    });

    await expect(
      db.one(
        `SELECT a.capability_id
         FROM capability_assignments a
         JOIN users u ON u.id = a.user_id
         WHERE u.username = ? AND a.capability_id = ?`,
        ["browser-user", "org__browser"],
      ),
    ).resolves.toEqual({ capability_id: "org__browser" });
  });

  it("does not overwrite a user-owned browser capability during the CDP migration", async () => {
    const db = await freshMysqlTestDatabase();
    await migrateMysqlGatewayDatabase(db);
    await db.execute("DELETE FROM schema_migrations WHERE version = ?", [18]);
    await db.execute(
      "UPDATE capability_definitions SET source_json = ?, config_json = ?, version = ? WHERE id = ?",
      [
        JSON.stringify({ type: "upload", locator: "custom-browser" }),
        JSON.stringify({ transport: "stdio", command: "node", args: ["custom-browser"] }),
        "9.0.0",
        "org__browser",
      ],
    );

    await migrateMysqlGatewayDatabase(db);

    await expect(createCapabilityStore(db).get("org__browser")).resolves.toMatchObject({
      version: "9.0.0",
      source: { type: "upload", locator: "custom-browser" },
      config: { transport: "stdio", command: "node", args: ["custom-browser"] },
    });
  });

  it("assigns the Infinity Dinky MCP to users that predate migration 15", async () => {
    const db = await freshMysqlTestDatabase();
    await migrateMysqlGatewayDatabase(db);
    await db.execute("DELETE FROM schema_migrations WHERE version = ?", [15]);
    await db.execute("DELETE FROM capability_assignments WHERE capability_id = ?", [
      "org__infinity",
    ]);
    await db.execute("DELETE FROM capability_definitions WHERE id = ?", ["org__infinity"]);
    await db.execute("INSERT INTO users (username, password_hash) VALUES (?, ?)", [
      "infinity-user",
      "password-hash",
    ]);

    await migrateMysqlGatewayDatabase(db);

    await expect(
      db.one(
        `SELECT a.capability_id
         FROM capability_assignments a
         JOIN users u ON u.id = a.user_id
         WHERE u.username = ? AND a.capability_id = ?`,
        ["infinity-user", "org__infinity"],
      ),
    ).resolves.toEqual({ capability_id: "org__infinity" });
  });
});
