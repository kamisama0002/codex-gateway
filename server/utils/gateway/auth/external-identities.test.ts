import { beforeEach, describe, expect, it } from "vitest";
import { freshMysqlTestDatabase } from "../../../../tests/mysql/helpers";
import { createRuntimePolicyStore } from "../runtime-manager/runtime-policy-store";
import type { GatewayDb } from "../storage/contracts";
import { verifyPassword } from "../storage/crypto";
import { migrateMysqlGatewayDatabase } from "../storage/mysql-migrations";
import { createExternalIdentityStore } from "./external-identities";
import type { DataOpsClaims } from "./dataops-claims";

const runtimePolicy = {
  version: 1 as const,
  imageAlias: "stable",
  memoryMiB: 2048,
  cpuCores: 2,
  pidsLimit: 256,
};

function claims(overrides: Partial<DataOpsClaims> = {}): DataOpsClaims {
  return {
    audience: "codex-gateway",
    tenantId: 1,
    userId: 9,
    username: "operator",
    externalSubject: "dataops:1:9",
    contextType: "PROJECT",
    projectId: 4,
    runtimeProfile: "DEVELOPMENT",
    platformAdmin: false,
    canDevelopAgents: false,
    canManageAgentStatus: false,
    canManageAgentRuntimeConfig: false,
    permissions: ["agent-center:view"],
    authzVersion: 3,
    issuedAt: "2026-09-04T00:00:00.000Z",
    ticket: null,
    ...overrides,
  };
}

describe("external DataOps identities", () => {
  let db: GatewayDb;

  beforeEach(async () => {
    db = await freshMysqlTestDatabase();
    await migrateMysqlGatewayDatabase(db);
  });

  it("creates one stable identity and complete sessions under concurrent first logins", async () => {
    let sequence = 0;
    const store = createExternalIdentityStore(db, {
      token: () => `token-${++sequence}`,
      now: () => new Date("2026-09-04T00:00:00.000Z"),
    });

    const [first, second] = await Promise.all([
      store.loginDataOps(claims({ projectId: 4 })),
      store.loginDataOps(claims({ projectId: 8, platformAdmin: true })),
    ]);

    expect(second.user.id).toBe(first.user.id);
    expect(await store.authenticateToken(first.token)).toMatchObject({
      id: first.user.id,
      dataOps: { tenantId: 1, dataOpsUserId: 9, projectId: 4, authzVersion: 3 },
    });
    expect(await store.authenticateToken(second.token)).toMatchObject({
      id: first.user.id,
      dataOps: { tenantId: 1, dataOpsUserId: 9, projectId: 8, authzVersion: 3 },
    });
    expect((await db.one<{ count: number }>("SELECT COUNT(*) AS count FROM users"))?.count).toBe(1);
    expect(
      (await db.one<{ count: number }>("SELECT COUNT(*) AS count FROM external_identities"))?.count,
    ).toBe(1);
    expect((await db.one<{ count: number }>("SELECT COUNT(*) AS count FROM sessions"))?.count).toBe(
      2,
    );
    expect(
      (await db.one<{ count: number }>("SELECT COUNT(*) AS count FROM external_session_contexts"))
        ?.count,
    ).toBe(2);
    const stored = await db.one<{ password_hash: string }>(
      "SELECT password_hash FROM users WHERE id = ?",
      [first.user.id],
    );
    expect(verifyPassword("any-password", stored?.password_hash ?? "")).toBe(false);
  });

  it("updates role and display name without changing the Gateway user", async () => {
    let sequence = 0;
    const store = createExternalIdentityStore(db, {
      token: () => `token-${++sequence}`,
      now: () => new Date("2026-09-04T00:00:00.000Z"),
    });
    const first = await store.loginDataOps(claims());

    const second = await store.loginDataOps(
      claims({ username: "renamed operator", platformAdmin: true }),
    );

    expect(second.user).toMatchObject({ id: first.user.id, role: "admin" });
    await expect(
      db.one("SELECT display_name FROM external_identities WHERE user_id = ?", [first.user.id]),
    ).resolves.toEqual({ display_name: "renamed operator" });
  });

  it("does not merge users from different DataOps subjects", async () => {
    let sequence = 0;
    const store = createExternalIdentityStore(db, {
      token: () => `token-${++sequence}`,
      now: () => new Date("2026-09-04T00:00:00.000Z"),
    });

    const first = await store.loginDataOps(claims());
    const second = await store.loginDataOps(
      claims({ tenantId: 2, userId: 9, externalSubject: "dataops:2:9" }),
    );

    expect(second.user.id).not.toBe(first.user.id);
  });

  it("persists a present policy and preserves it when a rollout-compatible Ticket omits policy", async () => {
    let sequence = 0;
    const store = createExternalIdentityStore(db, {
      token: () => `token-${++sequence}`,
      now: () => new Date("2026-09-04T00:01:00.000Z"),
    });
    const first = await store.loginDataOps(claims({ runtimePolicy }));

    const policies = createRuntimePolicyStore(db);
    const assigned = await policies.getByUserId(first.user.id);
    expect(assigned).toMatchObject({
      userId: first.user.id,
      tenantId: 1,
      imageAlias: "stable",
      cpuMillicores: 2000,
      sourceIssuedAt: "2026-09-04T00:00:00.000Z",
    });

    await store.loginDataOps(
      claims({ issuedAt: "2026-09-04T00:02:00.000Z", runtimePolicy: undefined }),
    );
    await expect(policies.getByUserId(first.user.id)).resolves.toEqual(assigned);
  });

  it("keeps the newer snapshot when an older Ticket is exchanged later", async () => {
    let sequence = 0;
    const store = createExternalIdentityStore(db, {
      token: () => `token-${++sequence}`,
      now: () => new Date("2026-09-04T00:03:00.000Z"),
    });
    const first = await store.loginDataOps(
      claims({
        issuedAt: "2026-09-04T00:02:00.000Z",
        runtimePolicy: { ...runtimePolicy, imageAlias: "newer", memoryMiB: 4096 },
      }),
    );

    await store.loginDataOps(
      claims({
        issuedAt: "2026-09-04T00:01:00.000Z",
        runtimePolicy: { ...runtimePolicy, imageAlias: "older", memoryMiB: 1024 },
      }),
    );

    await expect(createRuntimePolicyStore(db).getByUserId(first.user.id)).resolves.toMatchObject({
      imageAlias: "newer",
      memoryMiB: 4096,
      sourceIssuedAt: "2026-09-04T00:02:00.000Z",
    });
  });

  it("rolls back identity and session writes when policy persistence fails", async () => {
    await db.execute(`
      CREATE TRIGGER reject_runtime_policy
      BEFORE INSERT ON user_runtime_policies
      FOR EACH ROW
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'reject runtime policy'
    `);
    const store = createExternalIdentityStore(db, {
      token: () => "token-rejected",
      now: () => new Date("2026-09-04T00:01:00.000Z"),
    });

    await expect(store.loginDataOps(claims({ runtimePolicy }))).rejects.toThrow(
      "reject runtime policy",
    );

    for (const table of [
      "users",
      "external_identities",
      "user_runtime_policies",
      "sessions",
      "external_session_contexts",
    ]) {
      expect(
        (await db.one<{ count: number }>(`SELECT COUNT(*) AS count FROM ${table}`))?.count,
      ).toBe(0);
    }
  });
});
