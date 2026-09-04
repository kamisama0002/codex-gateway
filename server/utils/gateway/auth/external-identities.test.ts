import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { verifyPassword } from "../storage/crypto";
import { migrateGatewayDatabase } from "../storage/migrations";
import { createExternalIdentityStore } from "./external-identities";
import type { DataOpsClaims } from "./dataops-claims";

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
  it("reuses a stable Gateway user and binds project context to each session", async () => {
    const db = new DatabaseSync(":memory:");
    migrateGatewayDatabase(db);
    let sequence = 0;
    const store = createExternalIdentityStore(db, {
      token: () => `token-${++sequence}`,
      now: () => new Date("2026-09-04T00:00:00.000Z"),
    });

    const first = store.loginDataOps(claims());
    const second = store.loginDataOps(claims({ projectId: 8, platformAdmin: true }));

    expect(second.user.id).toBe(first.user.id);
    expect(second.user.role).toBe("admin");
    expect(store.authenticateToken(first.token)).toMatchObject({
      id: first.user.id,
      dataOps: { tenantId: 1, dataOpsUserId: 9, projectId: 4, authzVersion: 3 },
    });
    expect(store.authenticateToken(second.token)).toMatchObject({
      id: first.user.id,
      dataOps: { tenantId: 1, dataOpsUserId: 9, projectId: 8, authzVersion: 3 },
    });
    const stored = db.prepare("SELECT password_hash FROM users WHERE id = ?").get(first.user.id);
    expect(verifyPassword("any-password", String(stored?.password_hash))).toBe(false);

    const third = store.loginDataOps(claims({ platformAdmin: false }));
    expect(third.user).toMatchObject({ id: first.user.id, role: "user" });
  });

  it("does not merge users from different DataOps subjects", () => {
    const db = new DatabaseSync(":memory:");
    migrateGatewayDatabase(db);
    let sequence = 0;
    const store = createExternalIdentityStore(db, {
      token: () => `token-${++sequence}`,
      now: () => new Date("2026-09-04T00:00:00.000Z"),
    });

    const first = store.loginDataOps(claims());
    const second = store.loginDataOps(
      claims({ tenantId: 2, userId: 9, externalSubject: "dataops:2:9" }),
    );
    expect(second.user.id).not.toBe(first.user.id);
  });
});
