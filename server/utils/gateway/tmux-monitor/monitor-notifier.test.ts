import { beforeEach, describe, expect, it, vi } from "vitest";
import { freshMysqlTestDatabase } from "../../../../tests/mysql/helpers";
import type { HostRecord, TmuxPaneSnapshot } from "../../../../shared/types";
import { notificationCenter } from "../notifications/notification-center";
import type { DbRow, GatewayDb } from "../storage/contracts";
import { migrateMysqlGatewayDatabase } from "../storage/mysql-migrations";
import { TmuxMonitorNotifier } from "./monitor-notifier";
import { TmuxMonitorRepository } from "./repository";

describe("TmuxMonitorNotifier", () => {
  let db: GatewayDb;
  let repository: TmuxMonitorRepository;

  beforeEach(async () => {
    vi.restoreAllMocks();
    db = await freshMysqlTestDatabase();
    await migrateMysqlGatewayDatabase(db);
    await db.execute("INSERT INTO users (id, username, password_hash, role) VALUES (?, ?, ?, ?)", [
      1,
      "notifier-user",
      "hash",
      "user",
    ]);
    repository = new TmuxMonitorRepository(db);
  });

  it("leaves a monitor retryable when Bark delivery fails before acknowledgement", async () => {
    const completed = await completedMonitor(repository);
    const publish = vi
      .spyOn(notificationCenter, "publish")
      .mockRejectedValueOnce(new Error("Bark unavailable"))
      .mockResolvedValueOnce(undefined);
    const notifier = new TmuxMonitorNotifier(repository);

    await expect(notifier.publishCompletion(host(), completed)).rejects.toThrow("Bark unavailable");
    await expect(repository.getOwned(1, completed.id)).resolves.toMatchObject({
      notificationSentAt: null,
    });

    await notifier.publishCompletion(host(), completed);

    expect(publish).toHaveBeenCalledTimes(2);
    expect(typeof (await repository.getOwned(1, completed.id))?.notificationSentAt).toBe("string");
  });

  it("delivers again when MySQL acknowledgement fails after Bark delivery", async () => {
    const completed = await completedMonitor(repository);
    const publish = vi.spyOn(notificationCenter, "publish").mockResolvedValue(undefined);
    const notifier = new TmuxMonitorNotifier(
      new TmuxMonitorRepository(failFirstNotificationMark(db)),
    );

    await expect(notifier.publishCompletion(host(), completed)).rejects.toThrow(
      "notification mark failed",
    );
    await expect(repository.getOwned(1, completed.id)).resolves.toMatchObject({
      notificationSentAt: null,
    });

    await notifier.publishCompletion(host(), completed);

    expect(publish).toHaveBeenCalledTimes(2);
    expect(typeof (await repository.getOwned(1, completed.id))?.notificationSentAt).toBe("string");
  });
});

function failFirstNotificationMark(db: GatewayDb): GatewayDb {
  let failed = false;
  return {
    one<T extends DbRow>(sql: string, params = []) {
      return db.one<T>(sql, params);
    },
    many<T extends DbRow>(sql: string, params = []) {
      return db.many<T>(sql, params);
    },
    execute(sql, params = []) {
      if (!failed && /UPDATE tmux_monitors SET notification_sent_at/i.test(sql)) {
        failed = true;
        return Promise.reject(new Error("notification mark failed"));
      }
      return db.execute(sql, params);
    },
    transaction<T>(work: (tx: GatewayDb) => Promise<T>) {
      return db.transaction(work);
    },
    close() {
      return db.close();
    },
  };
}

async function completedMonitor(repository: TmuxMonitorRepository) {
  const monitor = await repository.create(1, 10, pane(), null, "once");
  return (await repository.complete(monitor, "returnedToShell", pane({ running: false })))!;
}

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

function host(): HostRecord {
  return {
    id: 10,
    name: "training-host",
    sshHost: "host.internal",
    username: "codex",
    port: 22,
    authMode: "password",
    privateKeyPath: null,
    password: "secret",
    proxyUrl: null,
    hasPassword: true,
    createdAt: "2026-09-05T00:00:00.000Z",
    updatedAt: "2026-09-05T00:00:00.000Z",
  };
}
