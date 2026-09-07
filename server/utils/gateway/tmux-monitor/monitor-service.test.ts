import { beforeEach, describe, expect, it, vi } from "vitest";
import { freshMysqlTestDatabase } from "../../../../tests/mysql/helpers";
import type { HostRecord, TmuxPaneSnapshot, TmuxSessionSnapshot } from "../../../../shared/types";
import { notificationCenter } from "../notifications/notification-center";
import type { GatewayDb } from "../storage/contracts";
import { migrateMysqlGatewayDatabase } from "../storage/mysql-migrations";
import { TmuxMonitorRepository } from "./repository";
import { TmuxMonitorService } from "./monitor-service";

describe("TmuxMonitorService", () => {
  let db: GatewayDb;
  let repository: TmuxMonitorRepository;

  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.spyOn(notificationCenter, "publish").mockResolvedValue(undefined);
    db = await freshMysqlTestDatabase();
    await migrateMysqlGatewayDatabase(db);
    await db.execute("INSERT INTO users (id, username, password_hash, role) VALUES (?, ?, ?, ?)", [
      1,
      "service-user",
      "hash",
      "user",
    ]);
    repository = new TmuxMonitorRepository(db);
  });

  it("maps a concurrent MySQL active-location conflict to HTTP 409", async () => {
    const scanner = scannerReturning([session(pane())]);
    const service = new TmuxMonitorService(repository, scanner);

    const attempts = await Promise.allSettled([
      service.create(1, host(), target(), () => true),
      service.create(1, host(), target(), () => true),
    ]);

    expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
    expect(attempts.find((attempt) => attempt.status === "rejected")).toMatchObject({
      reason: { statusCode: 409, statusMessage: "This tmux pane is already monitored" },
    });
  });

  it("persists a scan error before rejecting the host check", async () => {
    const monitor = await repository.create(1, 10, pane(), null, "once");
    const scanner = scannerReturning(new Error("remote scan failed"));
    const service = new TmuxMonitorService(repository, scanner);

    await expect(service.checkHost(1, host(), [monitor])).rejects.toThrow("remote scan failed");

    const persisted = await repository.getOwned(1, monitor.id);
    expect(persisted?.lastError).toBe("remote scan failed");
    expect(typeof persisted?.lastErrorAt).toBe("string");
  });

  it("awaits a permanent completion before returning the refreshed list", async () => {
    const monitor = await repository.create(1, 10, pane(), null, "permanent");
    const service = new TmuxMonitorService(
      repository,
      scannerReturning([session(pane({ running: false }))]),
    );
    vi.spyOn(service, "deliverPendingNotifications").mockResolvedValue(undefined);

    const result = await service.checkHost(1, host(), [monitor]);

    expect(result.active).toHaveLength(1);
    expect(result.active[0]).toMatchObject({ id: monitor.id, runStartedAt: null });
    expect(result.history).toHaveLength(1);
    expect(result.history[0]).toMatchObject({
      mode: "permanent",
      status: "completed",
      completionReason: "returnedToShell",
    });
  });

  it("does not let a deferred stale poll restart a permanently completed run", async () => {
    const monitor = await repository.create(1, 10, pane(), null, "permanent");
    let releaseStale!: (sessions: TmuxSessionSnapshot[]) => void;
    const staleScan = new Promise<TmuxSessionSnapshot[]>((resolve) => {
      releaseStale = resolve;
    });
    const scan = vi
      .fn<() => Promise<TmuxSessionSnapshot[]>>()
      .mockReturnValueOnce(staleScan)
      .mockResolvedValueOnce([]);
    const service = new TmuxMonitorService(repository, {
      scan,
      capturePane: vi.fn(async () => ({
        output: "",
        capturedAt: "2026-09-05T00:00:00.000Z",
      })),
    });

    const stalePoll = service.checkHost(1, host(), [monitor]);
    await vi.waitFor(() => expect(scan).toHaveBeenCalledOnce());
    await service.checkHost(1, host(), [monitor]);
    releaseStale([
      session(
        pane({
          sessionId: "$stale",
          sessionCreated: 1_700_000_300,
          paneId: "%stale",
          panePid: 555,
          currentCommand: "stale-run",
        }),
      ),
    ]);
    await stalePoll;

    await expect(repository.getOwned(1, monitor.id)).resolves.toMatchObject({
      sessionId: "$1",
      paneId: "%1",
      panePid: 111,
      runStartedAt: null,
    });
    expect((await repository.listForUser(1)).history).toHaveLength(1);
  });
});

function scannerReturning(sessions: TmuxSessionSnapshot[] | Error) {
  return {
    scan: vi.fn(async () => {
      if (sessions instanceof Error) throw sessions;
      return sessions;
    }),
    capturePane: vi.fn(async () => ({ output: "", capturedAt: "2026-09-05T00:00:00.000Z" })),
  };
}

function target() {
  return { mode: "once" as const, sessionId: "$1", paneId: "%1", thread: null };
}

function session(item: TmuxPaneSnapshot): TmuxSessionSnapshot {
  return {
    name: item.sessionName,
    sessionId: item.sessionId,
    sessionCreated: item.sessionCreated,
    panes: [item],
  };
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
