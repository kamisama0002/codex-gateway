import { beforeEach, describe, expect, it } from "vitest";
import { freshMysqlTestDatabase } from "../../../../tests/mysql/helpers";
import type { TmuxPaneSnapshot } from "../../../../shared/types";
import type { GatewayDb, SqlValue } from "../storage/contracts";
import { migrateMysqlGatewayDatabase } from "../storage/mysql-migrations";
import { TmuxMonitorRepository } from "./repository";

describe("TmuxMonitorRepository", () => {
  let db: GatewayDb;
  let repository: TmuxMonitorRepository;

  beforeEach(async () => {
    db = await freshMysqlTestDatabase();
    await migrateMysqlGatewayDatabase(db);
    await db.execute(
      "INSERT INTO users (id, username, password_hash, role) VALUES (?, ?, ?, ?), (?, ?, ?, ?)",
      [1, "monitor-user", "hash", "user", 2, "other-user", "hash", "user"],
    );
    repository = new TmuxMonitorRepository(db);
  });

  it("creates monitors with MySQL insert IDs and enforces one active monitor per location", async () => {
    const location = pane();
    const attempts = await Promise.allSettled([
      repository.create(1, 10, location, null, "once"),
      repository.create(1, 10, location, null, "permanent"),
    ]);

    expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
    const rejection = attempts.find((attempt) => attempt.status === "rejected");
    expect(rejection).toMatchObject({ reason: { code: "ER_DUP_ENTRY" } });
    const rows = await db.many<{ id: number }>(
      "SELECT id FROM tmux_monitors WHERE user_id = ? AND status = 'active'",
      [1],
    );
    expect(rows).toHaveLength(1);
    expect((await repository.getOwned(1, Number(rows[0]!.id)))?.id).toBe(Number(rows[0]!.id));
  });

  it("records checks and host errors before completing a once monitor", async () => {
    const monitor = await repository.create(1, 10, pane(), null, "once");
    await repository.recordHostError(1, 10, new Error("ssh unavailable"));
    const failed = await repository.getOwned(1, monitor.id);
    expect(failed?.lastError).toBe("ssh unavailable");
    expect(typeof failed?.lastErrorAt).toBe("string");

    await repository.recordChecked(
      monitor,
      pane({ panePid: 222, currentCommand: "python", running: true }),
    );
    expect(await repository.getOwned(1, monitor.id)).toMatchObject({
      panePid: 222,
      lastCommand: "python",
      lastError: null,
      lastErrorAt: null,
    });

    const completed = await repository.complete(
      (await repository.getOwned(1, monitor.id))!,
      "returnedToShell",
      pane({ panePid: 222, currentCommand: "bash", running: false }),
    );
    expect(completed).toMatchObject({
      status: "completed",
      completionReason: "returnedToShell",
      lastCommand: "bash",
      notificationSentAt: null,
    });
    expect((await repository.pollGroups())[0]?.pendingNotifications.map((item) => item.id)).toEqual(
      [monitor.id],
    );
  });

  it("atomically resets a permanent monitor and inserts only one history row for concurrent polls", async () => {
    const monitor = await repository.create(1, 10, pane(), null, "permanent");
    const attempts = await Promise.all([
      repository.completePermanentRun(monitor, "returnedToShell", pane({ running: false })),
      repository.completePermanentRun(monitor, "returnedToShell", pane({ running: false })),
    ]);

    expect(attempts.filter((result) => result !== null)).toHaveLength(1);
    expect(await repository.getOwned(1, monitor.id)).toMatchObject({
      mode: "permanent",
      status: "active",
      runStartedAt: null,
    });
    const history = await db.many<{ id: number; status: string }>(
      "SELECT id, status FROM tmux_monitors WHERE user_id = ? AND id != ?",
      [1, monitor.id],
    );
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ status: "completed" });

    await repository.startPermanentRun(
      (await repository.getOwned(1, monitor.id))!,
      pane({ sessionId: "$2", paneId: "%2", panePid: 333, currentCommand: "node" }),
    );
    const restarted = await repository.getOwned(1, monitor.id);
    expect(restarted).toMatchObject({
      sessionId: "$2",
      paneId: "%2",
      panePid: 333,
      initialCommand: "node",
    });
    expect(typeof restarted?.runStartedAt).toBe("string");
  });

  it("promotes, cancels, marks notifications, and deletes only owned host monitors", async () => {
    const once = await repository.create(1, 10, pane(), null, "once");
    const promoted = await repository.promote(once, pane({ running: false }));
    expect(promoted).toMatchObject({ mode: "permanent", status: "active", runStartedAt: null });

    const cancelled = await repository.cancel(1, once.id);
    expect(cancelled).toMatchObject({ status: "cancelled", completionReason: "cancelled" });
    await expect(repository.cancel(1, once.id)).resolves.toBeNull();

    const completed = await repository.create(1, 11, pane({ paneId: "%3" }), null, "once");
    await repository.complete(completed, "paneExited", null);
    await expect(repository.markNotificationSent(1, completed.id)).resolves.toBe(true);
    await expect(repository.markNotificationSent(1, completed.id)).resolves.toBe(false);

    const other = await repository.create(2, 10, pane(), null, "once");
    await repository.deleteHost(1, 10);
    await expect(repository.getOwned(1, once.id)).resolves.toBeNull();
    await expect(repository.getOwned(2, other.id)).resolves.toMatchObject({ id: other.id });
  });

  it("prunes deterministic eligible history IDs while retaining pending notifications", async () => {
    await insertCompletedHistory(db, 101);
    const pending = await repository.create(1, 10, pane({ paneId: "%pending" }), null, "once");
    await repository.complete(pending, "paneExited", null);
    const active = await repository.create(1, 10, pane({ paneId: "%active" }), null, "once");

    await repository.cancel(1, active.id);

    const eligible = await db.many<{ id: number }>(
      `SELECT id FROM tmux_monitors
       WHERE user_id = ? AND host_id = ? AND status != 'active'
         AND (status = 'cancelled' OR notification_sent_at IS NOT NULL)
       ORDER BY completed_at DESC, id DESC`,
      [1, 10],
    );
    expect(eligible).toHaveLength(100);
    expect(eligible.some((row) => Number(row.id) === 1)).toBe(false);
    await expect(repository.getOwned(1, pending.id)).resolves.toMatchObject({
      status: "completed",
      notificationSentAt: null,
    });
  });
});

function pane(overrides: Partial<TmuxPaneSnapshot> = {}): TmuxPaneSnapshot {
  return {
    sessionName: "training",
    sessionId: "$1",
    sessionCreated: 1_700_000_000,
    windowIndex: 0,
    windowName: "main",
    paneIndex: 0,
    paneId: "%1",
    panePid: 111,
    currentCommand: "python",
    running: true,
    ...overrides,
  };
}

async function insertCompletedHistory(db: GatewayDb, count: number) {
  const values: string[] = [];
  const params: SqlValue[] = [];
  for (let index = 0; index < count; index += 1) {
    values.push(
      "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'once', 'completed', 'paneExited', ?, ?, ?, ?)",
    );
    const timestamp = new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString();
    params.push(
      1,
      10,
      `history-${index}`,
      `$history-${index}`,
      1_700_000_000 + index,
      0,
      "main",
      0,
      `%history-${index}`,
      1000 + index,
      "python",
      "bash",
      timestamp,
      timestamp,
      timestamp,
      timestamp,
    );
  }
  await db.execute(
    `INSERT INTO tmux_monitors (
       user_id, host_id, session_name, session_id, session_created,
       window_index, window_name, pane_index, pane_id, pane_pid,
       initial_command, last_command, mode, status, completion_reason,
       created_at, last_checked_at, completed_at, notification_sent_at
     ) VALUES ${values.join(", ")}`,
    params,
  );
}
