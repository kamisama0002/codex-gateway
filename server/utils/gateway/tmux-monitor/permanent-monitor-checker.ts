import type { TmuxSessionSnapshot } from "~~/shared/types";
import { TmuxMonitorRepository } from "./repository";
import type { StoredTmuxMonitor } from "./types";

export class PermanentTmuxMonitorChecker {
  constructor(private readonly repository: TmuxMonitorRepository) {}

  async check(monitor: StoredTmuxMonitor, sessions: TmuxSessionSnapshot[]) {
    const pane = logicalPaneFor(monitor, sessions);

    // Permanent rules follow a logical tmux slot, not one pane PID. This lets a training
    // workspace return to shell or recreate the pane without silently losing the watch.
    if (monitor.runStartedAt === null) {
      if (pane === undefined) await this.repository.recordWaitingCheck(monitor);
      else if (pane.running === true) await this.repository.startPermanentRun(monitor, pane);
      else await this.repository.recordChecked(monitor, pane);
      return null;
    }

    if (pane === undefined) {
      const sessionExists = sessions.some((session) => session.name === monitor.sessionName);
      return await this.repository.completePermanentRun(
        monitor,
        sessionExists ? "paneExited" : "sessionExited",
        null,
      );
    }

    const replaced = pane.sessionId !== monitor.sessionId || pane.paneId !== monitor.paneId;
    if (replaced) {
      const completed = await this.repository.completePermanentRun(monitor, "paneReplaced", pane);
      if (completed !== null && pane.running === true) {
        const current = await this.repository.getOwned(monitor.userId, monitor.id);
        if (current?.status === "active" && current.runStartedAt === null) {
          await this.repository.startPermanentRun(current, pane);
        }
      }
      return completed;
    }
    if (pane.running === false) {
      return await this.repository.completePermanentRun(monitor, "returnedToShell", pane);
    }
    await this.repository.recordChecked(monitor, pane);
    return null;
  }
}

export function logicalPaneFor(monitor: StoredTmuxMonitor, sessions: TmuxSessionSnapshot[]) {
  return sessions
    .find((session) => session.name === monitor.sessionName)
    ?.panes.find(
      (pane) => pane.windowIndex === monitor.windowIndex && pane.paneIndex === monitor.paneIndex,
    );
}
