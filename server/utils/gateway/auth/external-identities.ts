import { createHash } from "node:crypto";
import { createRuntimePolicyStore } from "../runtime-manager/runtime-policy-store";
import type { DbRow, GatewayDb } from "../storage/contracts";
import { gatewayDatabase } from "../storage/database";
import { hashToken } from "../storage/crypto";
import type { DataOpsClaims, DataOpsSessionContext } from "./dataops-claims";
import { SessionRepository } from "./session-repository";
import { UserRepository } from "./user-repository";
import {
  createUserStore,
  issueSessionForUser,
  type AuthenticatedUser,
  type AuthSession,
  type SessionIssueOptions,
} from "./users";

const PROVIDER = "dataops";
const EXTERNAL_PASSWORD_MARKER = "external-login-disabled";

interface ExternalIdentityRow extends DbRow {
  user_id: number;
}

export interface ExternalIdentityStore {
  loginDataOps(claims: DataOpsClaims): Promise<AuthSession>;
  authenticateToken(token: string): Promise<AuthenticatedUser | null>;
}

export function createExternalIdentityStore(
  db: GatewayDb,
  sessionOptions: SessionIssueOptions = {},
): ExternalIdentityStore {
  return {
    async loginDataOps(claims) {
      return await db.transaction(async (tx) => loginDataOps(tx, claims, sessionOptions));
    },

    authenticateToken(token) {
      return createUserStore(db, sessionOptions).authenticateToken(token);
    },
  };
}

export const externalIdentityStore: Pick<ExternalIdentityStore, "loginDataOps"> = {
  loginDataOps(claims) {
    return createExternalIdentityStore(gatewayDatabase()).loginDataOps(claims);
  },
};

async function loginDataOps(
  db: GatewayDb,
  claims: DataOpsClaims,
  sessionOptions: SessionIssueOptions,
): Promise<AuthSession> {
  const now = (sessionOptions.now ?? (() => new Date()))();
  const nowText = now.toISOString();
  const role = claims.platformAdmin ? "admin" : "user";
  const users = new UserRepository(db);
  await users.lockIdentityCreation();
  const identity = await db.one<ExternalIdentityRow>(
    "SELECT user_id FROM external_identities WHERE provider = ? AND external_subject = ? FOR UPDATE",
    [PROVIDER, claims.externalSubject],
  );

  let userId: number;
  if (identity === null) {
    const username = await availableUsername(users, claims);
    const user = await users.create({
      username,
      passwordHash: EXTERNAL_PASSWORD_MARKER,
      role,
      now: nowText,
    });
    userId = user.id;
  } else {
    userId = Number(identity.user_id);
    await users.updateRole(userId, role, nowText);
  }

  await db.execute(
    `
      INSERT INTO external_identities (
        provider, external_subject, user_id, display_name, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        display_name = VALUES(display_name),
        updated_at = VALUES(updated_at)
    `,
    [PROVIDER, claims.externalSubject, userId, claims.username, nowText, nowText],
  );

  if (claims.runtimePolicy !== undefined) {
    await createRuntimePolicyStore(db).upsertIfNewer(
      {
        userId,
        tenantId: claims.tenantId,
        policy: claims.runtimePolicy,
        sourceIssuedAt: claims.issuedAt,
        now: nowText,
      },
      db,
    );
  }

  const storedUser = await users.findById(userId);
  if (storedUser === null || !storedUser.isActive) {
    throw new Error("External identity is disabled");
  }

  const user: AuthenticatedUser = {
    id: storedUser.id,
    username: storedUser.username,
    role: storedUser.role,
    dataOps: dataOpsContext(claims),
  };
  const session = await issueSessionForUser(db, user, { ...sessionOptions, now: () => now });
  await new SessionRepository(db).createExternalContext({
    tokenHash: hashToken(session.token),
    provider: PROVIDER,
    externalSubject: claims.externalSubject,
    tenantId: claims.tenantId,
    externalUserId: claims.userId,
    projectId: claims.projectId,
    authzVersion: claims.authzVersion,
    now: nowText,
  });
  return session;
}

async function availableUsername(users: UserRepository, claims: DataOpsClaims): Promise<string> {
  const base = `dataops-${claims.tenantId}-${claims.userId}`;
  if ((await users.findByUsername(base)) === null) return base;
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
