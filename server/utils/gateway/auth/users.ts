import { randomBytes } from "node:crypto";
import type { GatewayConfig } from "~~/shared/types";
import { defaultGatewayConfig } from "../../../../shared/config";
import type { DataOpsSessionContext } from "./dataops-claims";
import type { GatewayDb } from "../storage/contracts";
import { gatewayMysqlDatabase } from "../storage/mysql-database";
import { parseGatewayConfig } from "../http/validation/config";
import {
  decryptJson,
  encryptJson,
  hashPassword,
  hashToken,
  verifyPassword,
} from "../storage/crypto";
import { UserConfigRepository } from "../config/user-config-repository";
import { SessionRepository, type SessionAuthenticationRow } from "./session-repository";
import { sessionRevocationEvents } from "./session-events";
import { sessionActivityTracker } from "./session-activity-tracker";
import {
  databaseUserRole,
  normalizeUsername,
  UserRepository,
  type StoredUser,
} from "./user-repository";

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

export interface LoadedUserConfig {
  config: GatewayConfig;
  revision: number;
}

export interface StoredUserConfiguration extends LoadedUserConfig {
  user: AuthenticatedUser;
}

export interface UserStore {
  createUser(username: string, password: string): Promise<AuthenticatedUser>;
  findUsername(userId: number): Promise<string | null>;
  findByUsername(username: string): Promise<StoredUser | null>;
  login(username: string, password: string): Promise<AuthSession | null>;
  createSessionForUser(user: AuthenticatedUser): Promise<AuthSession>;
  authenticateToken(token: string): Promise<AuthenticatedUser | null>;
  deleteToken(token: string): Promise<void>;
  deleteExpiredSessions(now?: Date): Promise<number>;
  loadConfig(userId: number): Promise<LoadedUserConfig>;
  saveConfig(userId: number, config: GatewayConfig, expectedRevision: number): Promise<number>;
  listStoredConfigs(): Promise<StoredUserConfiguration[]>;
}

export async function issueSessionForUser(
  db: GatewayDb,
  user: AuthenticatedUser,
  options: SessionIssueOptions = {},
): Promise<AuthSession> {
  const now = (options.now ?? (() => new Date()))();
  const token = (options.token ?? (() => randomBytes(32).toString("base64url")))();
  const expiresAt = new Date(now.getTime() + SESSION_DAYS * 86_400_000).toISOString();
  await new SessionRepository(db).create({
    userId: user.id,
    tokenHash: hashToken(token),
    expiresAt,
    now: now.toISOString(),
  });
  return { token, expiresAt, user };
}

export function createUserStore(
  db: GatewayDb,
  sessionOptions: SessionIssueOptions = {},
): UserStore {
  const users = new UserRepository(db);
  const sessions = new SessionRepository(db);
  const configs = new UserConfigRepository(db);
  const currentTime = sessionOptions.now ?? (() => new Date());

  return {
    async createUser(username, password) {
      const normalized = normalizeUsername(username);
      if (normalized === "") throw new Error("Username is required");
      if (password.length < 8) throw new Error("Password must be at least 8 characters");
      const user = await users.createWithAutomaticRole({
        username: normalized,
        passwordHash: hashPassword(password),
        now: currentTime().toISOString(),
      });
      return authenticatedUser(user);
    },

    findUsername(userId) {
      return users.findUsername(userId);
    },

    findByUsername(username) {
      return users.findByUsername(username);
    },

    async login(username, password) {
      const user = await users.findByUsername(username);
      if (user === null || !user.isActive || !verifyPassword(password, user.passwordHash)) {
        return null;
      }
      return await issueSessionForUser(db, authenticatedUser(user), sessionOptions);
    },

    createSessionForUser(user) {
      return issueSessionForUser(db, user, sessionOptions);
    },

    async authenticateToken(token) {
      if (token === "") return null;
      const tokenHash = hashToken(token);
      const row = await sessions.findAuthentication(tokenHash);
      if (row === null || Number(row.is_active) !== 1) return null;
      if (Date.parse(String(row.expires_at)) <= currentTime().getTime()) {
        await this.deleteToken(token);
        return null;
      }
      sessionActivityTracker.touch(tokenHash);
      return authenticatedSessionUser(row);
    },

    async deleteToken(token) {
      const tokenHash = hashToken(token);
      sessionActivityTracker.forget(tokenHash);
      if (await sessions.deleteByTokenHash(tokenHash)) {
        sessionRevocationEvents.emit(tokenHash);
      }
    },

    async deleteExpiredSessions(now = currentTime()) {
      const tokenHashes = await sessions.deleteExpired(now.toISOString());
      for (const tokenHash of tokenHashes) {
        sessionActivityTracker.forget(tokenHash);
        sessionRevocationEvents.emit(tokenHash);
      }
      return tokenHashes.length;
    },

    async loadConfig(userId) {
      const stored = await configs.load(userId);
      if (stored === null || stored.encryptedConfigJson === "") {
        return { config: defaultGatewayConfig(), revision: 0 };
      }
      return {
        config: parsedStoredConfig(stored.encryptedConfigJson),
        revision: stored.revision,
      };
    },

    async saveConfig(userId, config, expectedRevision) {
      const encrypted = encryptJson(config);
      return await configs.save(userId, encrypted, expectedRevision, currentTime().toISOString());
    },

    async listStoredConfigs() {
      const stored = await configs.listActive();
      return stored.map((entry) => ({
        user: {
          id: entry.userId,
          username: entry.username,
          role: databaseUserRole(entry.role),
        },
        config: parsedStoredConfig(entry.encryptedConfigJson),
        revision: entry.revision,
      }));
    },
  };
}

export const userStore: UserStore = {
  createUser(username, password) {
    return productionUserStore().createUser(username, password);
  },
  findUsername(userId) {
    return productionUserStore().findUsername(userId);
  },
  findByUsername(username) {
    return productionUserStore().findByUsername(username);
  },
  login(username, password) {
    return productionUserStore().login(username, password);
  },
  createSessionForUser(user) {
    return productionUserStore().createSessionForUser(user);
  },
  authenticateToken(token) {
    return productionUserStore().authenticateToken(token);
  },
  deleteToken(token) {
    return productionUserStore().deleteToken(token);
  },
  deleteExpiredSessions(now) {
    return productionUserStore().deleteExpiredSessions(now);
  },
  loadConfig(userId) {
    return productionUserStore().loadConfig(userId);
  },
  saveConfig(userId, config, expectedRevision) {
    return productionUserStore().saveConfig(userId, config, expectedRevision);
  },
  listStoredConfigs() {
    return productionUserStore().listStoredConfigs();
  },
};

function productionUserStore(): UserStore {
  return createUserStore(gatewayMysqlDatabase());
}

function authenticatedUser(user: StoredUser): AuthenticatedUser {
  return { id: user.id, username: user.username, role: user.role };
}

function authenticatedSessionUser(row: SessionAuthenticationRow): AuthenticatedUser {
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
}

function parsedStoredConfig(encryptedConfigJson: string): GatewayConfig {
  return {
    ...defaultGatewayConfig(),
    ...parseGatewayConfig(decryptJson(encryptedConfigJson)),
  };
}
