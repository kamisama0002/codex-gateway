import { beforeEach, describe, expect, it, vi } from "vitest";
import { freshMysqlTestDatabase } from "../../../../tests/mysql/helpers";
import type { DbRow, GatewayDb } from "../storage/contracts";
import { migrateMysqlGatewayDatabase } from "../storage/mysql-migrations";
import { SessionActivityTracker } from "./session-activity-tracker";

describe("SessionActivityTracker", () => {
  let db: GatewayDb;

  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    db = await freshMysqlTestDatabase();
    await migrateMysqlGatewayDatabase(db);
    await db.execute("INSERT INTO users (id, username, password_hash, role) VALUES (?, ?, ?, ?)", [
      1,
      "activity-user",
      "hash",
      "user",
    ]);
    await insertSession(db, "token-1");
  });

  it("returns immediately and coalesces concurrent MySQL last-seen writes per token", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-05T01:00:00.000Z"));
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let writes = 0;
    const tracker = new SessionActivityTracker(() =>
      delayedActivityDatabase(db, gate, () => writes++),
    );

    expect(tracker.touch("token-1")).toBeUndefined();
    expect(tracker.touch("token-1")).toBeUndefined();
    await Promise.resolve();
    expect(writes).toBe(1);
    expect(await lastSeen(db, "token-1")).toBe("2026-09-05T00:00:00.000Z");

    release();
    await vi.waitFor(async () => {
      expect(await lastSeen(db, "token-1")).toBe("2026-09-05T01:00:00.000Z");
    });
    tracker.touch("token-1");
    await Promise.resolve();
    expect(writes).toBe(1);
  });

  it("cleans failed in-flight writes so ancillary errors are swallowed and retryable", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-05T02:00:00.000Z"));
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    let writes = 0;
    const activityDb = failFirstActivityWrite(db, () => writes++);
    const tracker = new SessionActivityTracker(() => activityDb);

    expect(() => tracker.touch("token-1")).not.toThrow();
    await vi.waitFor(() => expect(warning).toHaveBeenCalledOnce());
    await vi.waitFor(() => {
      tracker.touch("token-1");
      expect(writes).toBe(2);
    });

    await vi.waitFor(async () => {
      const writtenAt = Date.parse((await lastSeen(db, "token-1"))!);
      expect(writtenAt).toBeGreaterThanOrEqual(Date.parse("2026-09-05T02:00:00.000Z"));
      expect(writtenAt).toBeLessThan(Date.parse("2026-09-05T02:05:00.000Z"));
    });
    expect(writes).toBe(2);
  });

  it("bounds pending token writes without evicting an operation that is still in flight", async () => {
    const releases: Array<() => void> = [];
    let writes = 0;
    let completedWrites = 0;
    const tracker = new SessionActivityTracker(
      () =>
        pendingActivityDatabase(
          db,
          releases,
          () => writes++,
          () => completedWrites++,
        ),
      2,
    );

    tracker.touch("token-1");
    tracker.touch("token-2");
    tracker.touch("token-3");
    await Promise.resolve();

    expect(writes).toBe(2);
    releases.forEach((release) => release());
    await vi.waitFor(() => expect(completedWrites).toBe(2));
  });
});

function delayedActivityDatabase(
  db: GatewayDb,
  gate: Promise<void>,
  onWrite: () => void,
): GatewayDb {
  return wrapDatabase(db, async (sql, params) => {
    onWrite();
    await gate;
    return await db.execute(sql, params);
  });
}

function failFirstActivityWrite(db: GatewayDb, onWrite: () => void): GatewayDb {
  let first = true;
  return wrapDatabase(db, async (sql, params) => {
    onWrite();
    if (first) {
      first = false;
      throw new Error("activity write failed");
    }
    return await db.execute(sql, params);
  });
}

function pendingActivityDatabase(
  db: GatewayDb,
  releases: Array<() => void>,
  onWrite: () => void,
  onComplete: () => void,
): GatewayDb {
  return wrapDatabase(db, async (sql, params) => {
    onWrite();
    await new Promise<void>((resolve) => releases.push(resolve));
    const result = await db.execute(sql, params);
    onComplete();
    return result;
  });
}

function wrapDatabase(db: GatewayDb, execute: GatewayDb["execute"]): GatewayDb {
  return {
    one<T extends DbRow>(sql: string, params = []) {
      return db.one<T>(sql, params);
    },
    many<T extends DbRow>(sql: string, params = []) {
      return db.many<T>(sql, params);
    },
    execute,
    transaction<T>(work: (tx: GatewayDb) => Promise<T>) {
      return db.transaction(work);
    },
    close() {
      return db.close();
    },
  };
}

async function insertSession(db: GatewayDb, tokenHash: string) {
  await db.execute(
    `INSERT INTO sessions (user_id, token_hash, expires_at, created_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?)`,
    [
      1,
      tokenHash,
      "2026-10-05T00:00:00.000Z",
      "2026-09-05T00:00:00.000Z",
      "2026-09-05T00:00:00.000Z",
    ],
  );
}

async function lastSeen(db: GatewayDb, tokenHash: string) {
  const row = await db.one<{ last_seen_at: string }>(
    "SELECT last_seen_at FROM sessions WHERE token_hash = ?",
    [tokenHash],
  );
  return row?.last_seen_at ?? null;
}
