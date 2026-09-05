import { createError } from "h3";
import type {
  TmuxMonitorListResult,
  TmuxMonitorThreadBinding,
  TmuxPaneOutput,
  TmuxSessionSnapshot,
} from "~~/shared/types";
import type { HostWithSecret } from "../infra/ssh/ssh-types";
import { TmuxMonitorNotifier } from "./monitor-notifier";
import { logicalPaneFor, PermanentTmuxMonitorChecker } from "./permanent-monitor-checker";
import { RemoteTmuxScanner } from "./remote-scanner";
import { TmuxMonitorRepository } from "./repository";
import type { StoredTmuxMonitor } from "./types";
import { resolveTmuxThreadBinding } from "./thread-binding";
import { TmuxSessionStreamManager } from "./session-stream/manager";

export class TmuxMonitorService {
  private readonly notifier: TmuxMonitorNotifier;
  private readonly permanentChecker: PermanentTmuxMonitorChecker;
  readonly sessionStream: TmuxSessionStreamManager;

  constructor(
    private readonly repository = new TmuxMonitorRepository(),
    private readonly scanner: Pick<
      RemoteTmuxScanner,
      "scan" | "capturePane"
    > = new RemoteTmuxScanner(),
  ) {
    this.notifier = new TmuxMonitorNotifier(repository);
    this.permanentChecker = new PermanentTmuxMonitorChecker(repository);
    this.sessionStream = new TmuxSessionStreamManager((host) => this.scan(host));
  }

  async list(userId: number): Promise<TmuxMonitorListResult> {
    return await this.repository.listForUser(userId);
  }

  async pollGroups() {
    return await this.repository.pollGroups();
  }

  async removeHost(userId: number, hostId: number): Promise<void> {
    this.sessionStream.removeHost(userId, hostId);
    await this.repository.deleteHost(userId, hostId);
  }

  async cancelForHost(userId: number, hostId: number, monitorId: number) {
    const monitor = await this.repository.getOwned(userId, monitorId);
    if (!monitor || monitor.hostId !== hostId) {
      throw createError({ statusCode: 404, statusMessage: "Active monitor not found" });
    }
    return await this.cancel(userId, monitorId);
  }

  scan(host: HostWithSecret): Promise<TmuxSessionSnapshot[]> {
    return this.scanner.scan(host);
  }

  capturePane(
    host: HostWithSecret,
    target: { sessionId: string; paneId: string },
  ): Promise<TmuxPaneOutput> {
    return this.scanner.capturePane(host, target);
  }

  async create(
    userId: number,
    host: HostWithSecret,
    target: {
      mode: "once" | "permanent";
      sessionId: string;
      paneId: string;
      thread?: TmuxMonitorThreadBinding | null;
    },
    hostIsCurrent: () => boolean,
  ) {
    const sessions = await this.scanner.scan(host);
    if (!hostIsCurrent()) {
      throw createError({
        statusCode: 409,
        statusMessage: "Host changed while scanning tmux panes",
      });
    }
    const pane = sessions
      .find((session) => session.sessionId === target.sessionId)
      ?.panes.find((candidate) => candidate.paneId === target.paneId);
    if (!pane) {
      throw createError({
        statusCode: 409,
        statusMessage: "The selected tmux pane no longer exists",
      });
    }
    if (target.mode === "once" && !pane.running) {
      throw createError({
        statusCode: 409,
        statusMessage: "The selected tmux pane has already returned to its shell",
      });
    }
    try {
      return await this.repository.create(
        userId,
        host.id,
        pane,
        resolveTmuxThreadBinding(host.id, target.thread),
        target.mode,
      );
    } catch (error) {
      if (isDuplicateEntry(error)) {
        throw createError({
          statusCode: 409,
          statusMessage: "This tmux pane is already monitored",
        });
      }
      throw error;
    }
  }

  async cancel(userId: number, monitorId: number) {
    const monitor = await this.repository.cancel(userId, monitorId);
    if (!monitor) throw createError({ statusCode: 404, statusMessage: "Active monitor not found" });
    return monitor;
  }

  async promote(userId: number, host: HostWithSecret, monitorId: number) {
    const monitor = await this.repository.getOwned(userId, monitorId);
    if (!monitor || monitor.hostId !== host.id || monitor.status !== "active") {
      throw createError({ statusCode: 404, statusMessage: "Active monitor not found" });
    }
    if (monitor.mode === "permanent") return monitor;
    const sessions = await this.scanner.scan(host);
    const pane = logicalPaneFor(monitor, sessions);
    const promoted = await this.repository.promote(monitor, pane ?? null);
    if (!promoted)
      throw createError({ statusCode: 404, statusMessage: "Active monitor not found" });
    return promoted;
  }

  async checkHost(userId: number, host: HostWithSecret, monitors?: StoredTmuxMonitor[]) {
    const active = monitors ?? (await this.repository.activeForHost(userId, host.id));
    if (!active.length) return await this.list(userId);

    try {
      const sessions = await this.scanner.scan(host);
      const panes = sessions.flatMap((session) => session.panes);
      for (const monitor of active) {
        if (monitor.mode === "permanent") {
          const completed = await this.permanentChecker.check(monitor, sessions);
          if (completed) await this.notifier.publishCompletion(host, completed);
          continue;
        }
        const completion = completionFor(monitor, sessions, panes);
        if (!completion) {
          const pane = panes.find(
            (candidate) =>
              candidate.sessionId === monitor.sessionId && candidate.paneId === monitor.paneId,
          )!;
          await this.repository.recordChecked(monitor, pane);
          continue;
        }
        const completed = await this.repository.complete(
          monitor,
          completion.reason,
          completion.pane,
        );
        if (completed) await this.notifier.publishCompletion(host, completed);
      }
    } catch (error) {
      await this.repository.recordHostError(userId, host.id, error);
      throw error;
    }
    return await this.list(userId);
  }

  async deliverPendingNotifications(host: HostWithSecret, monitors: StoredTmuxMonitor[]) {
    for (const monitor of monitors) await this.notifier.publishCompletion(host, monitor);
  }
}

function isDuplicateEntry(error: unknown) {
  return (
    (typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ER_DUP_ENTRY") ||
    /UNIQUE constraint failed/i.test(error instanceof Error ? error.message : String(error))
  );
}

function completionFor(
  monitor: StoredTmuxMonitor,
  sessions: TmuxSessionSnapshot[],
  panes: TmuxSessionSnapshot["panes"],
) {
  const session = sessions.find(
    (candidate) =>
      candidate.sessionId === monitor.sessionId &&
      candidate.sessionCreated === monitor.sessionCreated,
  );
  if (!session) return { reason: "sessionExited" as const, pane: null };
  const pane = panes.find(
    (candidate) => candidate.sessionId === monitor.sessionId && candidate.paneId === monitor.paneId,
  );
  if (!pane) return { reason: "paneExited" as const, pane: null };
  if (pane.panePid !== monitor.panePid) return { reason: "paneReplaced" as const, pane };
  if (!pane.running) return { reason: "returnedToShell" as const, pane };
  return null;
}

export const tmuxMonitorService = new TmuxMonitorService();
