import { randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { GatewayConfig } from "~~/shared/types";
import { defaultGatewayConfig } from "../../../../shared/config";
import type { DataOpsSessionContext } from "./dataops-claims";
import { gatewayDatabase, gatewayDatabaseExists } from "../storage/database";
import { parseGatewayConfig } from "../http/validation/config";
import {
  decryptJson,
  encryptJson,
  hashPassword,
  hashToken,
  verifyPassword,
} from "../storage/crypto";
import { sessionRevocationEvents } from "./session-events";
import { sessionActivityTracker } from "./session-activity-tracker";

export interface AuthenticatedUser {
  id: number;
  username: string;
  role: "admin" | "user";
  dataOps?: DataOpsSessionContext;
}

export interface AuthSession {
  token: string;
  expiresAt: string;
  user: AuthenticatedUser;
}

const SESSION_DAYS = 30;

export interface SessionIssueOptions {
  token?: () => string;
  now?: () => Date;
}

export function issueSessionForUser(
  db: DatabaseSync,
  user: AuthenticatedUser,
  options: SessionIssueOptions = {},
): AuthSession {
  const now = (options.now ?? (() => new Date()))();
  const token = (options.token ?? (() => randomBytes(32).toString("base64url")))();
  const expiresAt = new Date(now.getTime() + SESSION_DAYS * 86_400_000).toISOString();
  db.prepare(
    "INSERT INTO sessions (user_id, token_hash, expires_at, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?)",
  ).run(user.id, hashToken(token), expiresAt, now.toISOString(), now.toISOString());
  return { token, expiresAt, user };
}

export const userStore = {
  createUser(username: string, password: string) {
    const normalized = normalizeUsername(username);
    if (!normalized) {
      throw new Error("Username is required");
    }
    if (password.length < 8) {
      throw new Error("Password must be at least 8 characters");
    }
    const now = new Date().toISOString();
    gatewayDatabase()
      .prepare(
        `
          INSERT INTO users (username, password_hash, is_active, role, created_at, updated_at)
          VALUES (?, ?, 1, CASE WHEN EXISTS (SELECT 1 FROM users WHERE role = 'admin') THEN 'user' ELSE 'admin' END, ?, ?)
        `,
      )
      .run(normalized, hashPassword(password), now, now);
    return this.findByUsername(normalized);
  },

  findUsername(userId: number) {
    if (!Number.isInteger(userId) || userId <= 0) return null;
    const row = gatewayDatabase()
      .prepare("SELECT username FROM users WHERE id = ?")
      .get(userId);
    return row === undefined ? null : String(row.username);
  },

  findByUsername(username: string) {
    const row = gatewayDatabase()
      .prepare("SELECT id, username, password_hash, is_active, role FROM users WHERE username = ?")
      .get(normalizeUsername(username));
    return row
      ? {
          id: Number(row.id),
          username: String(row.username),
          passwordHash: String(row.password_hash),
          isActive: Number(row.is_active) === 1,
          role: databaseUserRole(row.role),
        }
      : null;
  },

  async login(username: string, password: string): Promise<AuthSession | null> {
    const user = this.findByUsername(username);
    if (!user || !user.isActive || !verifyPassword(password, user.passwordHash)) {
      return null;
    }
    return this.createSessionForUser({ id: user.id, username: user.username, role: user.role });
  },

  createSessionForUser(user: AuthenticatedUser): AuthSession {
    return issueSessionForUser(gatewayDatabase(), user);
  },

  authenticateToken(token: string): AuthenticatedUser | null {
    if (!token) {
      return null;
    }
    const tokenHash = hashToken(token);
    const row = gatewayDatabase()
      .prepare(
        `
          SELECT users.id,
                 users.username,
                 users.role,
                 users.is_active,
                 sessions.expires_at,
                 external_session_contexts.provider,
                 external_session_contexts.external_subject,
                 external_session_contexts.tenant_id,
                 external_session_contexts.external_user_id,
                 external_session_contexts.project_id,
                 external_session_contexts.authz_version
          FROM sessions
          JOIN users ON users.id = sessions.user_id
          LEFT JOIN external_session_contexts
            ON external_session_contexts.token_hash = sessions.token_hash
          WHERE sessions.token_hash = ?
        `,
      )
      .get(tokenHash);
    if (!row || Number(row.is_active) !== 1) {
      return null;
    }
    if (Date.parse(String(row.expires_at)) <= Date.now()) {
      this.deleteToken(token);
      return null;
    }
    sessionActivityTracker.touch(tokenHash);
    const user: AuthenticatedUser = {
      id: Number(row.id),
      username: String(row.username),
      role: databaseUserRole(row.role),
    };
    if (row.provider === "dataops") {
      user.dataOps = {
        provider: "dataops",
        externalSubject: String(row.external_subject),
        tenantId: Number(row.tenant_id),
        dataOpsUserId: Number(row.external_user_id),
        projectId: Number(row.project_id),
        authzVersion: Number(row.authz_version),
      };
    }
    return user;
  },

  deleteToken(token: string) {
    const tokenHash = hashToken(token);
    sessionActivityTracker.forget(tokenHash);
    const result = gatewayDatabase()
      .prepare("DELETE FROM sessions WHERE token_hash = ?")
      .run(tokenHash);
    if (result.changes > 0) {
      sessionRevocationEvents.emit(tokenHash);
    }
  },

  deleteExpiredSessions() {
    const now = new Date().toISOString();
    const rows = gatewayDatabase()
      .prepare("SELECT token_hash FROM sessions WHERE expires_at <= ?")
      .all(now);
    if (!rows.length) {
      return 0;
    }
    const result = gatewayDatabase().prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now);
    for (const row of rows) {
      sessionRevocationEvents.emit(String(row.token_hash));
    }
    return Number(result.changes);
  },

  loadConfig(userId: number): GatewayConfig {
    const row = gatewayDatabase()
      .prepare("SELECT encrypted_config_json FROM user_configs WHERE user_id = ?")
      .get(userId);
    if (
      row === undefined ||
      row.encrypted_config_json === null ||
      row.encrypted_config_json === undefined ||
      row.encrypted_config_json === ""
    ) {
      return defaultGatewayConfig();
    }
    return {
      ...defaultGatewayConfig(),
      ...parseGatewayConfig(decryptJson(String(row.encrypted_config_json))),
    };
  },

  saveConfig(userId: number, config: GatewayConfig) {
    const encrypted = encryptJson(config);
    const now = new Date().toISOString();
    gatewayDatabase()
      .prepare(
        `
          INSERT INTO user_configs (user_id, encrypted_config_json, updated_at)
          VALUES (?, ?, ?)
          ON CONFLICT(user_id) DO UPDATE SET
            encrypted_config_json = excluded.encrypted_config_json,
            updated_at = excluded.updated_at
        `,
      )
      .run(userId, encrypted, now);
  },

  listStoredConfigs(): Array<{ user: AuthenticatedUser; config: GatewayConfig }> {
    if (!gatewayDatabaseExists()) {
      return [];
    }
    const rows = gatewayDatabase()
      .prepare(
        `
          SELECT users.id, users.username, users.role, user_configs.encrypted_config_json
          FROM users
          JOIN user_configs ON user_configs.user_id = users.id
          WHERE users.is_active = 1
          ORDER BY users.id ASC
        `,
      )
      .all();
    return rows.map((row) => ({
      user: {
        id: Number(row.id),
        username: String(row.username),
        role: databaseUserRole(row.role),
      },
      config: {
        ...defaultGatewayConfig(),
        ...parseGatewayConfig(decryptJson(String(row.encrypted_config_json))),
      },
    }));
  },
};

function normalizeUsername(username: string) {
  return username.trim().toLowerCase();
}

function databaseUserRole(value: unknown): AuthenticatedUser["role"] {
  if (value === "admin" || value === "user") return value;
  throw new Error("Stored user role is invalid");
}
