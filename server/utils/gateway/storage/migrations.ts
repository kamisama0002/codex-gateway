import type { DatabaseSync } from "node:sqlite";

import { MANAGED_RUNTIME_HOST_ID } from "../../../../shared/runtime/managed-runtime.ts";

interface DatabaseMigration {
  version: number;
  up(db: DatabaseSync): void;
}

const migrations: DatabaseMigration[] = [
  {
    version: 1,
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT NOT NULL UNIQUE,
          password_hash TEXT NOT NULL,
          is_active INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS sessions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          token_hash TEXT NOT NULL UNIQUE,
          expires_at TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          last_seen_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS user_configs (
          user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          encrypted_config_json TEXT NOT NULL,
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS tmux_monitors (
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

        CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash);
        CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
        CREATE INDEX IF NOT EXISTS idx_tmux_monitors_host
          ON tmux_monitors(user_id, host_id, status, created_at DESC);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_tmux_monitors_active_location
          ON tmux_monitors(user_id, host_id, session_name, window_index, pane_index)
          WHERE status = 'active';
      `);
    },
  },
  {
    version: 2,
    up(db) {
      db.exec(
        "ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user'))",
      );
      const admin = db.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get();
      if (admin === undefined) {
        db.prepare(
          `
            UPDATE users
            SET role = 'admin'
            WHERE id = (
              SELECT id FROM users
              WHERE is_active = 1
              ORDER BY created_at ASC, id ASC
              LIMIT 1
            )
          `,
        ).run();
      }
    },
  },
  {
    version: 3,
    up(db) {
      db.exec(`
        CREATE TABLE user_agent_runtimes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
          host_id INTEGER NOT NULL DEFAULT ${MANAGED_RUNTIME_HOST_ID} CHECK (host_id = ${MANAGED_RUNTIME_HOST_ID}),
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
      `);
    },
  },
  {
    version: 4,
    up(db) {
      db.exec(`
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

        CREATE INDEX idx_agent_audit_events_user_created
          ON agent_audit_events(user_id, created_at DESC, id DESC);
        CREATE INDEX idx_agent_audit_events_created
          ON agent_audit_events(created_at DESC, id DESC);
      `);
    },
  },
  {
    version: 5,
    up(db) {
      db.exec(`
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

        CREATE INDEX idx_provider_models_enabled
          ON provider_models(provider_id, enabled, model_id);
      `);
    },
  },
  {
    version: 6,
    up(db) {
      db.exec(`
        CREATE TABLE user_model_grants (
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          provider_id TEXT NOT NULL,
          model_id TEXT NOT NULL,
          created_at TEXT NOT NULL,
          PRIMARY KEY (user_id, provider_id, model_id),
          FOREIGN KEY (provider_id, model_id)
            REFERENCES provider_models(provider_id, model_id) ON DELETE CASCADE
        ) STRICT;

        CREATE INDEX idx_user_model_grants_model
          ON user_model_grants(provider_id, model_id, user_id);
      `);
    },
  },
  {
    version: 7,
    up(db) {
      db.exec("CREATE INDEX idx_model_providers_enabled ON model_providers(enabled, name)");
    },
  },
];

export function migrateGatewayDatabase(db: DatabaseSync): void {
  db.exec(
    "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)",
  );
  for (const migration of migrations) {
    if (isApplied(db, migration.version)) continue;
    db.exec("BEGIN IMMEDIATE");
    try {
      migration.up(db);
      db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(
        migration.version,
        new Date().toISOString(),
      );
      db.exec("COMMIT");
    } catch (error) {
      if (db.isTransaction) db.exec("ROLLBACK");
      throw error;
    }
  }
}

function isApplied(db: DatabaseSync, version: number) {
  return db.prepare("SELECT 1 FROM schema_migrations WHERE version = ?").get(version) !== undefined;
}
