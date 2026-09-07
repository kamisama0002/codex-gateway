import { MANAGED_RUNTIME_HOST_ID } from "../../../../shared/runtime/managed-runtime.ts";

export interface MysqlSchemaMigration {
  version: number;
  statements: readonly string[];
}

export const MYSQL_SCHEMA_MIGRATIONS: readonly MysqlSchemaMigration[] = [
  {
    version: 1,
    statements: [
      `
        CREATE TABLE IF NOT EXISTS users (
          id INT UNSIGNED NOT NULL AUTO_INCREMENT,
          username VARCHAR(255) NOT NULL,
          password_hash VARCHAR(512) NOT NULL,
          is_active TINYINT(1) NOT NULL DEFAULT 1,
          created_at VARCHAR(32) NOT NULL DEFAULT (DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%fZ')),
          updated_at VARCHAR(32) NOT NULL DEFAULT (DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%fZ')),
          PRIMARY KEY (id),
          UNIQUE KEY uq_users_username (username)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin
      `,
      `
        CREATE TABLE IF NOT EXISTS sessions (
          id INT UNSIGNED NOT NULL AUTO_INCREMENT,
          user_id INT UNSIGNED NOT NULL,
          token_hash VARCHAR(255) NOT NULL,
          expires_at VARCHAR(32) NOT NULL,
          created_at VARCHAR(32) NOT NULL DEFAULT (DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%fZ')),
          last_seen_at VARCHAR(32) NOT NULL DEFAULT (DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%fZ')),
          PRIMARY KEY (id),
          UNIQUE KEY uq_sessions_token_hash (token_hash),
          KEY idx_sessions_expires_at (expires_at),
          CONSTRAINT fk_sessions_user_id
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin
      `,
      `
        CREATE TABLE IF NOT EXISTS user_configs (
          user_id INT UNSIGNED NOT NULL,
          encrypted_config_json LONGTEXT NOT NULL,
          revision BIGINT UNSIGNED NOT NULL DEFAULT 1,
          updated_at VARCHAR(32) NOT NULL DEFAULT (DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%fZ')),
          PRIMARY KEY (user_id),
          CONSTRAINT fk_user_configs_user_id
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin
      `,
      `
        CREATE TABLE IF NOT EXISTS tmux_monitors (
          id INT UNSIGNED NOT NULL AUTO_INCREMENT,
          user_id INT UNSIGNED NOT NULL,
          host_id INT UNSIGNED NOT NULL,
          project_id INT UNSIGNED NULL,
          thread_id VARCHAR(255) NULL,
          thread_title VARCHAR(1024) NULL,
          session_name VARCHAR(255) NOT NULL,
          session_id VARCHAR(255) NOT NULL,
          session_created BIGINT UNSIGNED NOT NULL,
          window_index INT UNSIGNED NOT NULL,
          window_name VARCHAR(255) NOT NULL,
          pane_index INT UNSIGNED NOT NULL,
          pane_id VARCHAR(255) NOT NULL,
          pane_pid INT UNSIGNED NOT NULL,
          initial_command TEXT NOT NULL,
          last_command TEXT NOT NULL,
          mode VARCHAR(16) NOT NULL DEFAULT 'once',
          status VARCHAR(16) NOT NULL,
          completion_reason VARCHAR(255) NULL,
          created_at VARCHAR(32) NOT NULL,
          run_started_at VARCHAR(32) NULL,
          last_checked_at VARCHAR(32) NULL,
          completed_at VARCHAR(32) NULL,
          last_error TEXT NULL,
          last_error_at VARCHAR(32) NULL,
          notification_sent_at VARCHAR(32) NULL,
          active_marker TINYINT
            GENERATED ALWAYS AS (
              IF(status = 'active', 1, NULL)
            ) STORED,
          PRIMARY KEY (id),
          KEY idx_tmux_monitors_host (user_id, host_id, status, created_at DESC),
          UNIQUE KEY uq_tmux_active_location (user_id, host_id, session_name, window_index, pane_index, active_marker),
          CONSTRAINT chk_tmux_monitors_mode CHECK (mode IN ('once', 'permanent')),
          CONSTRAINT chk_tmux_monitors_status CHECK (status IN ('active', 'completed', 'cancelled')),
          CONSTRAINT fk_tmux_monitors_user_id
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin
      `,
    ],
  },
  {
    version: 2,
    statements: [
      `
        ALTER TABLE users
          ADD COLUMN role VARCHAR(16) NOT NULL DEFAULT 'user',
          ADD CONSTRAINT chk_users_role CHECK (role IN ('admin', 'user'))
      `,
      `
        UPDATE users
        SET role = 'admin'
        WHERE id = (
          SELECT id FROM (
            SELECT id
            FROM users
            WHERE is_active = 1
            ORDER BY created_at ASC, id ASC
            LIMIT 1
          ) AS oldest_active_user
        )
        AND NOT EXISTS (
          SELECT 1 FROM (
            SELECT id
            FROM users
            WHERE role = 'admin'
            LIMIT 1
          ) AS existing_admin
        )
      `,
    ],
  },
  {
    version: 3,
    statements: [
      `
        CREATE TABLE IF NOT EXISTS user_agent_runtimes (
          id INT UNSIGNED NOT NULL AUTO_INCREMENT,
          user_id INT UNSIGNED NOT NULL,
          host_id INT UNSIGNED NOT NULL DEFAULT ${MANAGED_RUNTIME_HOST_ID},
          runtime_type VARCHAR(64) NOT NULL,
          container_id VARCHAR(255) NULL,
          image_version VARCHAR(255) NOT NULL,
          runtime_version VARCHAR(255) NOT NULL,
          schema_hash VARCHAR(255) NOT NULL,
          status VARCHAR(64) NOT NULL,
          last_error TEXT NULL,
          created_at VARCHAR(32) NOT NULL,
          updated_at VARCHAR(32) NOT NULL,
          PRIMARY KEY (id),
          UNIQUE KEY uq_user_agent_runtimes_user_id (user_id),
          CONSTRAINT chk_user_agent_runtimes_host_id CHECK (host_id = ${MANAGED_RUNTIME_HOST_ID}),
          CONSTRAINT fk_user_agent_runtimes_user_id
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin
      `,
    ],
  },
  {
    version: 4,
    statements: [
      `
        CREATE TABLE IF NOT EXISTS agent_audit_events (
          id INT UNSIGNED NOT NULL AUTO_INCREMENT,
          actor_user_id INT UNSIGNED NULL,
          user_id INT UNSIGNED NULL,
          action VARCHAR(255) NOT NULL,
          outcome VARCHAR(64) NOT NULL,
          error_code VARCHAR(255) NULL,
          metadata_json LONGTEXT NOT NULL DEFAULT ('{}'),
          created_at VARCHAR(32) NOT NULL,
          PRIMARY KEY (id),
          KEY idx_agent_audit_events_user_created (user_id, created_at DESC, id DESC),
          KEY idx_agent_audit_events_created (created_at DESC, id DESC),
          CONSTRAINT fk_agent_audit_events_actor_user_id
            FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL,
          CONSTRAINT fk_agent_audit_events_user_id
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin
      `,
    ],
  },
  {
    version: 5,
    statements: [
      `
        CREATE TABLE IF NOT EXISTS model_providers (
          id VARCHAR(255) NOT NULL,
          name VARCHAR(255) NOT NULL,
          base_url VARCHAR(2048) NOT NULL,
          wire_api VARCHAR(32) NOT NULL,
          encrypted_api_key LONGTEXT NOT NULL,
          enabled TINYINT(1) NOT NULL DEFAULT 1,
          request_timeout_ms INT UNSIGNED NOT NULL,
          created_at VARCHAR(32) NOT NULL,
          updated_at VARCHAR(32) NOT NULL,
          PRIMARY KEY (id),
          CONSTRAINT chk_model_providers_wire_api CHECK (wire_api IN ('responses', 'chat_completions')),
          CONSTRAINT chk_model_providers_enabled CHECK (enabled IN (0, 1)),
          CONSTRAINT chk_model_providers_timeout CHECK (request_timeout_ms BETWEEN 1000 AND 300000)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin
      `,
      `
        CREATE TABLE IF NOT EXISTS provider_models (
          provider_id VARCHAR(255) NOT NULL,
          model_id VARCHAR(255) NOT NULL,
          display_name VARCHAR(255) NOT NULL,
          enabled TINYINT(1) NOT NULL DEFAULT 1,
          capabilities_json LONGTEXT NOT NULL,
          created_at VARCHAR(32) NOT NULL,
          updated_at VARCHAR(32) NOT NULL,
          PRIMARY KEY (provider_id, model_id),
          KEY idx_provider_models_enabled (provider_id, enabled, model_id),
          CONSTRAINT chk_provider_models_enabled CHECK (enabled IN (0, 1)),
          CONSTRAINT fk_provider_models_provider_id
            FOREIGN KEY (provider_id) REFERENCES model_providers(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin
      `,
    ],
  },
  {
    version: 6,
    statements: [
      `
        CREATE TABLE IF NOT EXISTS user_model_grants (
          user_id INT UNSIGNED NOT NULL,
          provider_id VARCHAR(255) NOT NULL,
          model_id VARCHAR(255) NOT NULL,
          created_at VARCHAR(32) NOT NULL,
          PRIMARY KEY (user_id, provider_id, model_id),
          KEY idx_user_model_grants_model (provider_id, model_id, user_id),
          CONSTRAINT fk_user_model_grants_user_id
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          CONSTRAINT fk_user_model_grants_provider_model
            FOREIGN KEY (provider_id, model_id)
            REFERENCES provider_models(provider_id, model_id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin
      `,
    ],
  },
  {
    version: 7,
    statements: ["CREATE INDEX idx_model_providers_enabled ON model_providers(enabled, name)"],
  },
  {
    version: 8,
    statements: [
      `
        CREATE TABLE IF NOT EXISTS external_identities (
          provider VARCHAR(128) NOT NULL,
          external_subject VARCHAR(512) NOT NULL,
          user_id INT UNSIGNED NOT NULL,
          display_name VARCHAR(255) NOT NULL,
          created_at VARCHAR(32) NOT NULL,
          updated_at VARCHAR(32) NOT NULL,
          PRIMARY KEY (provider, external_subject),
          UNIQUE KEY uq_external_identities_user_id (user_id),
          KEY idx_external_identities_user (user_id),
          CONSTRAINT fk_external_identities_user_id
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin
      `,
      `
        CREATE TABLE IF NOT EXISTS external_session_contexts (
          token_hash VARCHAR(255) NOT NULL,
          provider VARCHAR(128) NOT NULL,
          external_subject VARCHAR(512) NOT NULL,
          tenant_id INT UNSIGNED NOT NULL,
          external_user_id INT UNSIGNED NOT NULL,
          project_id INT UNSIGNED NOT NULL,
          authz_version INT UNSIGNED NOT NULL,
          created_at VARCHAR(32) NOT NULL,
          PRIMARY KEY (token_hash),
          KEY idx_external_session_contexts_project (tenant_id, project_id, external_user_id),
          CONSTRAINT fk_external_session_contexts_token_hash
            FOREIGN KEY (token_hash) REFERENCES sessions(token_hash) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin
      `,
    ],
  },
  {
    version: 9,
    statements: [
      `
        CREATE TABLE IF NOT EXISTS capability_definitions (
          id VARCHAR(128) NOT NULL,
          kind VARCHAR(16) NOT NULL,
          display_name VARCHAR(128) NOT NULL,
          description TEXT NOT NULL,
          version VARCHAR(64) NOT NULL,
          source_json LONGTEXT NOT NULL,
          config_json LONGTEXT NOT NULL,
          sensitive_fields_json LONGTEXT NOT NULL,
          enabled TINYINT(1) NOT NULL DEFAULT 1,
          created_by_user_id INT UNSIGNED NULL,
          created_at VARCHAR(32) NOT NULL,
          updated_at VARCHAR(32) NOT NULL,
          PRIMARY KEY (id),
          CONSTRAINT chk_capability_definitions_kind
            CHECK (kind IN ('skill', 'plugin', 'app', 'mcp', 'search')),
          CONSTRAINT chk_capability_definitions_enabled CHECK (enabled IN (0, 1)),
          CONSTRAINT chk_capability_definitions_id CHECK (id LIKE 'org\\_\\_%'),
          CONSTRAINT fk_capability_definitions_created_by
            FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin
      `,
      `
        CREATE TABLE IF NOT EXISTS capability_artifacts (
          capability_id VARCHAR(128) NOT NULL,
          version VARCHAR(64) NOT NULL,
          sha256 CHAR(64) NOT NULL,
          storage_path TEXT NOT NULL,
          size_bytes BIGINT UNSIGNED NOT NULL,
          created_at VARCHAR(32) NOT NULL,
          PRIMARY KEY (capability_id, version),
          CONSTRAINT chk_capability_artifacts_sha256 CHECK (sha256 REGEXP '^[a-f0-9]{64}$'),
          CONSTRAINT fk_capability_artifacts_capability
            FOREIGN KEY (capability_id) REFERENCES capability_definitions(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin
      `,
      `
        CREATE TABLE IF NOT EXISTS capability_assignments (
          id INT UNSIGNED NOT NULL AUTO_INCREMENT,
          capability_id VARCHAR(128) NOT NULL,
          user_id INT UNSIGNED NOT NULL,
          project_id INT UNSIGNED NULL,
          scope_project_id INT UNSIGNED
            GENERATED ALWAYS AS (IFNULL(project_id, 0)) STORED,
          created_at VARCHAR(32) NOT NULL,
          PRIMARY KEY (id),
          UNIQUE KEY uq_capability_assignments_scope
            (capability_id, user_id, scope_project_id),
          KEY idx_capability_assignments_context (user_id, project_id, capability_id),
          CONSTRAINT chk_capability_assignments_project CHECK (project_id IS NULL OR project_id > 0),
          CONSTRAINT fk_capability_assignments_capability
            FOREIGN KEY (capability_id) REFERENCES capability_definitions(id) ON DELETE CASCADE,
          CONSTRAINT fk_capability_assignments_user
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin
      `,
      `
        CREATE TABLE IF NOT EXISTS capability_syncs (
          id INT UNSIGNED NOT NULL AUTO_INCREMENT,
          user_id INT UNSIGNED NOT NULL,
          project_id INT UNSIGNED NULL,
          scope_project_id INT UNSIGNED
            GENERATED ALWAYS AS (IFNULL(project_id, 0)) STORED,
          desired_hash CHAR(64) NOT NULL,
          actual_hash CHAR(64) NULL,
          status VARCHAR(16) NOT NULL,
          results_json LONGTEXT NOT NULL,
          safe_error TEXT NULL,
          attempt_count INT UNSIGNED NOT NULL DEFAULT 0,
          created_at VARCHAR(32) NOT NULL,
          updated_at VARCHAR(32) NOT NULL,
          PRIMARY KEY (id),
          UNIQUE KEY uq_capability_syncs_scope (user_id, scope_project_id),
          KEY idx_capability_syncs_status (status, updated_at),
          CONSTRAINT chk_capability_syncs_project CHECK (project_id IS NULL OR project_id > 0),
          CONSTRAINT chk_capability_syncs_status
            CHECK (status IN ('pending', 'running', 'succeeded', 'failed')),
          CONSTRAINT fk_capability_syncs_user
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin
      `,
    ],
  },
];
