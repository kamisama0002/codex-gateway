#!/usr/bin/env node
import { createCipheriv, createHash } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const MANAGED_RUNTIME_HOST_ID = 2_000_000_000;

/**
 * @param {string} outputPath
 * @param {string} secret
 */
export function buildGatewayV8Sqlite(outputPath, secret) {
  if (typeof outputPath !== "string" || outputPath.length === 0) {
    throw new Error("SQLite fixture output path is required");
  }
  if (typeof secret !== "string" || secret.length === 0) {
    throw new Error("SQLite fixture encryption secret is required");
  }
  if (existsSync(outputPath)) {
    throw new Error("SQLite fixture output already exists");
  }

  mkdirSync(dirname(outputPath), { recursive: true });
  const db = new DatabaseSync(outputPath);
  try {
    db.exec("PRAGMA foreign_keys = ON");
    db.exec("BEGIN IMMEDIATE");
    createSchema(db);
    insertFixtureRows(db, secret);
    db.exec("COMMIT");
  } catch (error) {
    if (db.isTransaction) db.exec("ROLLBACK");
    throw error;
  } finally {
    db.close();
  }
}

/** @param {DatabaseSync} db */
function createSchema(db) {
  db.exec(`
    CREATE TABLE schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );

    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user'))
    );

    CREATE TABLE sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE user_configs (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      encrypted_config_json TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE tmux_monitors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      host_id INTEGER NOT NULL,
      project_id INTEGER,
      thread_id TEXT,
      thread_title TEXT,
      session_name TEXT NOT NULL,
      session_id TEXT NOT NULL,
      session_created INTEGER NOT NULL,
      window_index INTEGER NOT NULL,
      window_name TEXT NOT NULL,
      pane_index INTEGER NOT NULL,
      pane_id TEXT NOT NULL,
      pane_pid INTEGER NOT NULL,
      initial_command TEXT NOT NULL,
      last_command TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'once' CHECK (mode IN ('once', 'permanent')),
      status TEXT NOT NULL CHECK (status IN ('active', 'completed', 'cancelled')),
      completion_reason TEXT,
      created_at TEXT NOT NULL,
      run_started_at TEXT,
      last_checked_at TEXT,
      completed_at TEXT,
      last_error TEXT,
      last_error_at TEXT,
      notification_sent_at TEXT
    );

    CREATE UNIQUE INDEX idx_tmux_monitors_active_location
      ON tmux_monitors(user_id, host_id, session_name, window_index, pane_index)
      WHERE status = 'active';

    CREATE TABLE user_agent_runtimes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      host_id INTEGER NOT NULL DEFAULT ${MANAGED_RUNTIME_HOST_ID}
        CHECK (host_id = ${MANAGED_RUNTIME_HOST_ID}),
      runtime_type TEXT NOT NULL,
      container_id TEXT,
      image_version TEXT NOT NULL,
      runtime_version TEXT NOT NULL,
      schema_hash TEXT NOT NULL,
      status TEXT NOT NULL,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE agent_audit_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      outcome TEXT NOT NULL,
      error_code TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );

    CREATE TABLE model_providers (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      base_url TEXT NOT NULL,
      wire_api TEXT NOT NULL CHECK (wire_api IN ('responses', 'chat_completions')),
      encrypted_api_key TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
      request_timeout_ms INTEGER NOT NULL CHECK (request_timeout_ms BETWEEN 1000 AND 300000),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE provider_models (
      provider_id TEXT NOT NULL REFERENCES model_providers(id) ON DELETE CASCADE,
      model_id TEXT NOT NULL,
      display_name TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
      capabilities_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (provider_id, model_id)
    ) STRICT;

    CREATE TABLE user_model_grants (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider_id TEXT NOT NULL,
      model_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (user_id, provider_id, model_id),
      FOREIGN KEY (provider_id, model_id)
        REFERENCES provider_models(provider_id, model_id) ON DELETE CASCADE
    ) STRICT;

    CREATE TABLE external_identities (
      provider TEXT NOT NULL,
      external_subject TEXT NOT NULL,
      user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      display_name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (provider, external_subject)
    ) STRICT;

    CREATE TABLE external_session_contexts (
      token_hash TEXT PRIMARY KEY REFERENCES sessions(token_hash) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      external_subject TEXT NOT NULL,
      tenant_id INTEGER NOT NULL,
      external_user_id INTEGER NOT NULL,
      project_id INTEGER NOT NULL,
      authz_version INTEGER NOT NULL,
      created_at TEXT NOT NULL
    ) STRICT;

    CREATE INDEX idx_sessions_token_hash ON sessions(token_hash);
    CREATE INDEX idx_sessions_expires_at ON sessions(expires_at);
    CREATE INDEX idx_tmux_monitors_host
      ON tmux_monitors(user_id, host_id, status, created_at DESC);
    CREATE INDEX idx_agent_audit_events_user_created
      ON agent_audit_events(user_id, created_at DESC, id DESC);
    CREATE INDEX idx_agent_audit_events_created
      ON agent_audit_events(created_at DESC, id DESC);
    CREATE INDEX idx_provider_models_enabled
      ON provider_models(provider_id, enabled, model_id);
    CREATE INDEX idx_user_model_grants_model
      ON user_model_grants(provider_id, model_id, user_id);
    CREATE INDEX idx_model_providers_enabled ON model_providers(enabled, name);
    CREATE INDEX idx_external_identities_user ON external_identities(user_id);
    CREATE INDEX idx_external_session_contexts_project
      ON external_session_contexts(tenant_id, project_id, external_user_id);
  `);
}

/**
 * @param {DatabaseSync} db
 * @param {string} secret
 */
function insertFixtureRows(db, secret) {
  const activeTokenHash = createHash("sha256").update("fixture-local-session").digest("hex");
  const expiredTokenHash = createHash("sha256").update("fixture-dataops-session").digest("hex");
  const encryptedConfig = encryptFixtureJson(
    {
      hosts: [{ id: 31, name: "fixture-host", hostname: "fixture.internal", username: "codex" }],
      projects: [{ id: 73, hostId: 31, name: "fixture-project", path: "/srv/fixture" }],
    },
    secret,
    "user-config-101",
  );
  const encryptedResponsesKey = encryptFixtureJson(
    { apiKey: "fixture-responses-secret" },
    secret,
    "provider-responses",
  );
  const encryptedChatKey = encryptFixtureJson(
    { apiKey: "fixture-chat-secret" },
    secret,
    "provider-chat",
  );

  const insertMigration = db.prepare(
    "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)",
  );
  for (let version = 1; version <= 8; version += 1) {
    insertMigration.run(version, `2025-01-08T00:00:0${version}.000Z`);
  }

  const insertUser = db.prepare(
    "INSERT INTO users (id, username, password_hash, is_active, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  insertUser.run(
    101,
    "fixture-local-admin",
    "argon2id$Zml4dHVyZS1sb2NhbC1zYWx0$Zml4dHVyZS1sb2NhbC1oYXNo",
    1,
    "admin",
    "2025-01-01T01:01:01.001Z",
    "2025-01-02T02:02:02.002Z",
  );
  insertUser.run(
    205,
    "fixture-dataops-user",
    "argon2id$Zml4dHVyZS1kYXRhb3BzLXNhbHQ$Zml4dHVyZS1kYXRhb3BzLWhhc2g",
    1,
    "user",
    "2025-02-01T01:01:01.001Z",
    "2025-02-02T02:02:02.002Z",
  );

  const insertSession = db.prepare(
    "INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)",
  );
  insertSession.run(
    401,
    101,
    activeTokenHash,
    "2035-01-01T00:00:00.000Z",
    "2025-03-01T03:03:03.003Z",
    "2025-03-02T03:03:03.003Z",
  );
  insertSession.run(
    509,
    205,
    expiredTokenHash,
    "2024-01-01T00:00:00.000Z",
    "2025-03-03T03:03:03.003Z",
    "2025-03-04T03:03:03.003Z",
  );

  db.prepare(
    "INSERT INTO user_configs (user_id, encrypted_config_json, updated_at) VALUES (?, ?, ?)",
  ).run(101, encryptedConfig, "2025-04-01T04:04:04.004Z");

  const insertMonitor = db.prepare(`
    INSERT INTO tmux_monitors (
      id, user_id, host_id, project_id, thread_id, thread_title, session_name, session_id,
      session_created, window_index, window_name, pane_index, pane_id, pane_pid,
      initial_command, last_command, mode, status, completion_reason, created_at,
      run_started_at, last_checked_at, completed_at, last_error, last_error_at,
      notification_sent_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertMonitor.run(
    701,
    101,
    31,
    73,
    "thread-fixture-once",
    "Fixture once monitor",
    "fixture-once",
    "$31",
    1_735_689_600,
    2,
    "editor",
    1,
    "%71",
    71_001,
    "codex run once",
    "codex completed",
    "once",
    "completed",
    "process_exit",
    "2025-05-01T05:05:05.005Z",
    "2025-05-01T05:06:05.005Z",
    "2025-05-01T05:07:05.005Z",
    "2025-05-01T05:08:05.005Z",
    null,
    null,
    "2025-05-01T05:09:05.005Z",
  );
  insertMonitor.run(
    909,
    205,
    41,
    83,
    "thread-fixture-permanent",
    "Fixture permanent monitor",
    "fixture-permanent",
    "$41",
    1_735_776_000,
    4,
    "worker",
    0,
    "%90",
    90_900,
    "codex watch",
    "codex watch",
    "permanent",
    "active",
    null,
    "2025-05-02T05:05:05.005Z",
    "2025-05-02T05:06:05.005Z",
    "2025-05-02T05:07:05.005Z",
    null,
    null,
    null,
    null,
  );

  db.prepare(`
    INSERT INTO user_agent_runtimes (
      id, user_id, host_id, runtime_type, container_id, image_version, runtime_version,
      schema_hash, status, last_error, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    1201,
    101,
    MANAGED_RUNTIME_HOST_ID,
    "codex-app-server",
    "fixture-container-1201",
    "codex-image-2025.09",
    "runtime-5.0.0",
    "schema-fixture-v8",
    "running",
    null,
    "2025-06-01T06:06:06.006Z",
    "2025-06-02T06:06:06.006Z",
  );

  const insertAudit = db.prepare(`
    INSERT INTO agent_audit_events (
      id, actor_user_id, user_id, action, outcome, error_code, metadata_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertAudit.run(
    1501,
    101,
    205,
    "runtime.start",
    "success",
    null,
    '{"source":"fixture"}',
    "2025-07-01T07:07:07.007Z",
  );
  insertAudit.run(
    1603,
    null,
    101,
    "provider.request",
    "failure",
    "fixture_failure",
    '{"attempt":2}',
    "2025-07-02T07:07:07.007Z",
  );

  const insertProvider = db.prepare(`
    INSERT INTO model_providers (
      id, name, base_url, wire_api, encrypted_api_key, enabled, request_timeout_ms,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertProvider.run(
    "fixture.responses",
    "Fixture Responses",
    "https://responses.fixture.invalid/v1",
    "responses",
    encryptedResponsesKey,
    1,
    45_001,
    "2025-08-01T08:08:08.008Z",
    "2025-08-02T08:08:08.008Z",
  );
  insertProvider.run(
    "fixture.chat",
    "Fixture Chat",
    "https://chat.fixture.invalid/v1",
    "chat_completions",
    encryptedChatKey,
    0,
    60_003,
    "2025-08-03T08:08:08.008Z",
    "2025-08-04T08:08:08.008Z",
  );

  const insertModel = db.prepare(`
    INSERT INTO provider_models (
      provider_id, model_id, display_name, enabled, capabilities_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  insertModel.run(
    "fixture.responses",
    "reasoning-large",
    "Reasoning Large",
    1,
    '{"reasoning":true,"vision":true}',
    "2025-08-05T08:08:08.008Z",
    "2025-08-06T08:08:08.008Z",
  );
  insertModel.run(
    "fixture.responses",
    "reasoning-small",
    "Reasoning Small",
    1,
    '{"reasoning":true,"vision":false}',
    "2025-08-07T08:08:08.008Z",
    "2025-08-08T08:08:08.008Z",
  );
  insertModel.run(
    "fixture.chat",
    "chat-standard",
    "Chat Standard",
    0,
    '{"reasoning":false,"vision":false}',
    "2025-08-09T08:08:08.008Z",
    "2025-08-10T08:08:08.008Z",
  );

  const insertGrant = db.prepare(
    "INSERT INTO user_model_grants (user_id, provider_id, model_id, created_at) VALUES (?, ?, ?, ?)",
  );
  insertGrant.run(101, "fixture.responses", "reasoning-large", "2025-08-11T08:08:08.008Z");
  insertGrant.run(205, "fixture.responses", "reasoning-small", "2025-08-12T08:08:08.008Z");
  insertGrant.run(205, "fixture.chat", "chat-standard", "2025-08-13T08:08:08.008Z");

  db.prepare(`
    INSERT INTO external_identities (
      provider, external_subject, user_id, display_name, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    "dataops",
    "fixture-subject-205",
    205,
    "Fixture DataOps User",
    "2025-09-01T09:09:09.009Z",
    "2025-09-02T09:09:09.009Z",
  );

  db.prepare(`
    INSERT INTO external_session_contexts (
      token_hash, provider, external_subject, tenant_id, external_user_id, project_id,
      authz_version, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    expiredTokenHash,
    "dataops",
    "fixture-subject-205",
    3101,
    3205,
    3307,
    11,
    "2025-09-03T09:09:09.009Z",
  );
}

/**
 * @param {unknown} value
 * @param {string} secret
 * @param {string} label
 */
function encryptFixtureJson(value, secret, label) {
  const key = createHash("sha256").update(secret).digest();
  const iv = createHash("sha256").update(`codex-gateway-fixture:${label}`).digest().subarray(0, 12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.from(JSON.stringify(value), "utf8")),
    cipher.final(),
  ]);
  return [
    "v1",
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    ciphertext.toString("base64url"),
  ].join("$");
}

/**
 * @param {string[]} argv
 * @returns {{ help: true } | { help: false, outputPath: string }}
 */
function parseCliArguments(argv) {
  if (argv.includes("--help")) return { help: true };
  if (argv.length === 2 && argv[0] === "--output" && argv[1] !== undefined) {
    return { help: false, outputPath: resolve(argv[1]) };
  }
  throw new Error("Usage: node tests/fixtures/build-gateway-v8-sqlite.mjs --output <path>");
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseCliArguments(process.argv.slice(2));
    if (options.help) {
      console.log("Usage: node tests/fixtures/build-gateway-v8-sqlite.mjs --output <path>");
    } else {
      buildGatewayV8Sqlite(options.outputPath, process.env.CODEX_GATEWAY_CONFIG_SECRET ?? "");
      console.log("Gateway SQLite v8 fixture created");
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Could not build SQLite fixture");
    process.exitCode = 1;
  }
}
