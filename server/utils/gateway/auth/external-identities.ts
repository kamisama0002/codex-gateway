import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { gatewayDatabase } from "../storage/database";
import { hashToken } from "../storage/crypto";
import type { DataOpsClaims, DataOpsSessionContext } from "./dataops-claims";
import {
  issueSessionForUser,
  type AuthenticatedUser,
  type AuthSession,
  type SessionIssueOptions,
} from "./users";

const PROVIDER = "dataops";
const EXTERNAL_PASSWORD_MARKER = "external-login-disabled";

export interface ExternalIdentityStore {
  loginDataOps(claims: DataOpsClaims): AuthSession;
  authenticateToken(token: string): AuthenticatedUser | null;
}

export function createExternalIdentityStore(
  db: DatabaseSync,
  sessionOptions: SessionIssueOptions = {},
): ExternalIdentityStore {
  return {
    loginDataOps(claims) {
      return inTransaction(db, () => loginDataOps(db, claims, sessionOptions));
    },

    authenticateToken(token) {
      return authenticateExternalToken(db, token, sessionOptions.now);
    },
  };
}

export const externalIdentityStore: Pick<ExternalIdentityStore, "loginDataOps"> = {
  loginDataOps(claims) {
    return createExternalIdentityStore(gatewayDatabase()).loginDataOps(claims);
  },
};

function loginDataOps(
  db: DatabaseSync,
  claims: DataOpsClaims,
  sessionOptions: SessionIssueOptions,
): AuthSession {
  const now = (sessionOptions.now ?? (() => new Date()))();
  const nowText = now.toISOString();
  const role = claims.platformAdmin ? "admin" : "user";
  const identity = db
    .prepare("SELECT user_id FROM external_identities WHERE provider = ? AND external_subject = ?")
    .get(PROVIDER, claims.externalSubject);

  let userId: number;
  if (identity === undefined) {
    const username = availableUsername(db, claims);
    const inserted = db
      .prepare(
        `
          INSERT INTO users (username, password_hash, is_active, role, created_at, updated_at)
          VALUES (?, ?, 1, ?, ?, ?)
        `,
      )
      .run(username, EXTERNAL_PASSWORD_MARKER, role, nowText, nowText);
    userId = Number(inserted.lastInsertRowid);
    db.prepare(
      `
        INSERT INTO external_identities (
          provider, external_subject, user_id, display_name, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `,
    ).run(PROVIDER, claims.externalSubject, userId, claims.username, nowText, nowText);
  } else {
    userId = Number(identity.user_id);
    db.prepare(
      "UPDATE external_identities SET display_name = ?, updated_at = ? WHERE provider = ? AND external_subject = ?",
    ).run(claims.username, nowText, PROVIDER, claims.externalSubject);
    db.prepare("UPDATE users SET role = ?, updated_at = ? WHERE id = ?").run(role, nowText, userId);
  }

  const userRow = db
    .prepare("SELECT id, username, role, is_active FROM users WHERE id = ?")
    .get(userId);
  if (userRow === undefined || Number(userRow.is_active) !== 1) {
    throw new Error("External identity is disabled");
  }

  const dataOps = dataOpsContext(claims);
  const user: AuthenticatedUser = {
    id: Number(userRow.id),
    username: String(userRow.username),
    role: databaseRole(userRow.role),
    dataOps,
  };
  const session = issueSessionForUser(db, user, { ...sessionOptions, now: () => now });
  db.prepare(
    `
      INSERT INTO external_session_contexts (
        token_hash, provider, external_subject, tenant_id, external_user_id,
        project_id, authz_version, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(
    hashToken(session.token),
    PROVIDER,
    claims.externalSubject,
    claims.tenantId,
    claims.userId,
    claims.projectId,
    claims.authzVersion,
    nowText,
  );
  return session;
}

function authenticateExternalToken(
  db: DatabaseSync,
  token: string,
  now: SessionIssueOptions["now"],
): AuthenticatedUser | null {
  if (token === "") return null;
  const row = db
    .prepare(
      `
        SELECT users.id, users.username, users.role, users.is_active, sessions.expires_at,
               external_session_contexts.provider, external_session_contexts.external_subject,
               external_session_contexts.tenant_id, external_session_contexts.external_user_id,
               external_session_contexts.project_id, external_session_contexts.authz_version
        FROM sessions
        JOIN users ON users.id = sessions.user_id
        LEFT JOIN external_session_contexts
          ON external_session_contexts.token_hash = sessions.token_hash
        WHERE sessions.token_hash = ?
      `,
    )
    .get(hashToken(token));
  if (
    row === undefined ||
    Number(row.is_active) !== 1 ||
    Date.parse(String(row.expires_at)) <= (now ?? (() => new Date()))().getTime()
  ) {
    return null;
  }
  const user: AuthenticatedUser = {
    id: Number(row.id),
    username: String(row.username),
    role: databaseRole(row.role),
  };
  if (row.provider === PROVIDER) {
    user.dataOps = {
      provider: PROVIDER,
      externalSubject: String(row.external_subject),
      tenantId: Number(row.tenant_id),
      dataOpsUserId: Number(row.external_user_id),
      projectId: Number(row.project_id),
      authzVersion: Number(row.authz_version),
    };
  }
  return user;
}

function availableUsername(db: DatabaseSync, claims: DataOpsClaims): string {
  const base = `dataops-${claims.tenantId}-${claims.userId}`;
  if (db.prepare("SELECT 1 FROM users WHERE username = ?").get(base) === undefined) return base;
  const suffix = createHash("sha256").update(claims.externalSubject).digest("hex").slice(0, 10);
  return `${base}-${suffix}`;
}

function dataOpsContext(claims: DataOpsClaims): DataOpsSessionContext {
  return {
    provider: PROVIDER,
    externalSubject: claims.externalSubject,
    tenantId: claims.tenantId,
    dataOpsUserId: claims.userId,
    projectId: claims.projectId,
    authzVersion: claims.authzVersion,
  };
}

function databaseRole(value: unknown): AuthenticatedUser["role"] {
  if (value === "admin" || value === "user") return value;
  throw new Error("Stored user role is invalid");
}

function inTransaction<T>(db: DatabaseSync, callback: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const value = callback();
    db.exec("COMMIT");
    return value;
  } catch (error) {
    if (db.isTransaction) db.exec("ROLLBACK");
    throw error;
  }
}
