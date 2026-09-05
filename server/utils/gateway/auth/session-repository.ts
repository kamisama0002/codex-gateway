import type { DbRow, GatewayDb } from "../storage/contracts";

export interface SessionAuthenticationRow extends DbRow {
  id: number;
  username: string;
  role: string;
  is_active: number;
  expires_at: string;
  provider: string | null;
  external_subject: string | null;
  tenant_id: number | null;
  external_user_id: number | null;
  project_id: number | null;
  authz_version: number | null;
}

export interface CreateSessionInput {
  userId: number;
  tokenHash: string;
  expiresAt: string;
  now: string;
}

export interface ExternalSessionContextInput {
  tokenHash: string;
  provider: string;
  externalSubject: string;
  tenantId: number;
  externalUserId: number;
  projectId: number;
  authzVersion: number;
  now: string;
}

export class SessionRepository {
  constructor(private readonly db: GatewayDb) {}

  async create(input: CreateSessionInput): Promise<void> {
    await this.db.execute(
      `
        INSERT INTO sessions (user_id, token_hash, expires_at, created_at, last_seen_at)
        VALUES (?, ?, ?, ?, ?)
      `,
      [input.userId, input.tokenHash, input.expiresAt, input.now, input.now],
    );
  }

  async findAuthentication(tokenHash: string): Promise<SessionAuthenticationRow | null> {
    return await this.db.one<SessionAuthenticationRow>(
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
      [tokenHash],
    );
  }

  async createExternalContext(input: ExternalSessionContextInput): Promise<void> {
    await this.db.execute(
      `
        INSERT INTO external_session_contexts (
          token_hash, provider, external_subject, tenant_id, external_user_id,
          project_id, authz_version, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        input.tokenHash,
        input.provider,
        input.externalSubject,
        input.tenantId,
        input.externalUserId,
        input.projectId,
        input.authzVersion,
        input.now,
      ],
    );
  }

  async deleteByTokenHash(tokenHash: string): Promise<boolean> {
    return (
      (await this.db.execute("DELETE FROM sessions WHERE token_hash = ?", [tokenHash]))
        .affectedRows > 0
    );
  }

  async deleteExpired(now: string): Promise<string[]> {
    return await this.db.transaction(async (tx) => {
      const rows = await tx.many<{ token_hash: string }>(
        "SELECT token_hash FROM sessions WHERE expires_at <= ? FOR UPDATE",
        [now],
      );
      if (rows.length === 0) return [];
      await tx.execute("DELETE FROM sessions WHERE expires_at <= ?", [now]);
      return rows.map((row) => String(row.token_hash));
    });
  }
}
