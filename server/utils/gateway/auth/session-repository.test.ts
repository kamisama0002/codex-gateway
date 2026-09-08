import { beforeEach, describe, expect, it, vi } from "vitest";
import { freshMysqlTestDatabase } from "../../../../tests/mysql/helpers";
import type { GatewayDb } from "../storage/contracts";
import { hashToken } from "../storage/crypto";
import { migrateMysqlGatewayDatabase } from "../storage/mysql-migrations";
import { sessionRevocationEvents } from "./session-events";
import { UserRepository } from "./user-repository";
import { createUserStore } from "./users";

describe("SessionRepository", () => {
  let db: GatewayDb;

  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    db = await freshMysqlTestDatabase();
    await migrateMysqlGatewayDatabase(db);
  });

  it("deletes an expired session when authentication discovers it", async () => {
    let now = new Date("2026-09-05T00:00:00.000Z");
    const store = createUserStore(db, {
      token: () => "expired-token",
      now: () => now,
    });
    const user = await storedUser(db, "expiring-user");
    const session = await store.createSessionForUser(user);
    now = new Date("2026-10-06T00:00:00.000Z");

    await expect(store.authenticateToken(session.token)).resolves.toBeNull();
    await expect(
      db.one("SELECT token_hash FROM sessions WHERE token_hash = ?", [hashToken(session.token)]),
    ).resolves.toBeNull();
  });

  it("records successful authentication activity through the injected database", async () => {
    let now = new Date("2026-09-05T00:00:00.000Z");
    const store = createUserStore(db, {
      token: () => "active-token",
      now: () => now,
    });
    const user = await storedUser(db, "active-user");
    const session = await store.createSessionForUser(user);
    now = new Date("2026-09-05T01:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(store.authenticateToken(session.token)).resolves.toMatchObject({ id: user.id });

    await vi.waitFor(async () => {
      const row = await db.one<{ last_seen_at: string }>(
        "SELECT last_seen_at FROM sessions WHERE token_hash = ?",
        [hashToken(session.token)],
      );
      expect(row?.last_seen_at).toBe("2026-09-05T01:00:00.000Z");
    });
    expect(warning).not.toHaveBeenCalled();
  });

  it("revokes a logged-out session and notifies its realtime subscribers", async () => {
    const store = createUserStore(db, {
      token: () => "logout-token",
      now: () => new Date("2026-09-05T00:00:00.000Z"),
    });
    const user = await storedUser(db, "logout-user");
    const session = await store.createSessionForUser(user);
    const revoked = vi.fn();
    const unsubscribe = sessionRevocationEvents.subscribe(hashToken(session.token), revoked);

    await store.deleteToken(session.token);

    expect(revoked).toHaveBeenCalledOnce();
    await expect(store.authenticateToken(session.token)).resolves.toBeNull();
    unsubscribe();
  });

  it("deletes every expired session and publishes each revocation", async () => {
    let sequence = 0;
    const store = createUserStore(db, {
      token: () => `cleanup-token-${++sequence}`,
      now: () => new Date("2026-09-05T00:00:00.000Z"),
    });
    const user = await storedUser(db, "cleanup-user");
    const first = await store.createSessionForUser(user);
    const second = await store.createSessionForUser(user);
    const firstRevoked = vi.fn();
    const secondRevoked = vi.fn();
    sessionRevocationEvents.subscribe(hashToken(first.token), firstRevoked);
    sessionRevocationEvents.subscribe(hashToken(second.token), secondRevoked);

    const deleted = await store.deleteExpiredSessions(new Date("2026-10-06T00:00:00.000Z"));

    expect(deleted).toBe(2);
    expect(firstRevoked).toHaveBeenCalledOnce();
    expect(secondRevoked).toHaveBeenCalledOnce();
  });
});

function storedUser(db: GatewayDb, username: string) {
  return new UserRepository(db).createWithAutomaticRole({
    username,
    passwordHash: "stored-password-hash",
    now: "2026-09-05T00:00:00.000Z",
  });
}
