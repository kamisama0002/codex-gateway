import type {
  TmuxMonitorCompletionReason,
  TmuxMonitorListResult,
  TmuxMonitorMode,
  TmuxMonitorThreadBinding,
  TmuxPaneSnapshot,
} from "~~/shared/types";
import { z } from "zod";
import type { GatewayDb } from "../storage/contracts";
import { gatewayDatabase } from "../storage/database";
import type { StoredTmuxMonitor, TmuxMonitorHostGroup } from "./types";

const HISTORY_LIMIT = 100;
const tmuxMonitorModeSchema = z.enum(["once", "permanent"]);
const tmuxMonitorStatusSchema = z.enum(["active", "completed", "cancelled"]);
const tmuxMonitorCompletionReasonSchema = z.enum([
  "returnedToShell",
  "sessionExited",
  "paneExited",
  "paneReplaced",
  "cancelled",
]);

type DatabaseProvider = () => GatewayDb;

export class TmuxMonitorRepository {
  private readonly database: DatabaseProvider;

  constructor(database: GatewayDb | DatabaseProvider = gatewayDatabase) {
    this.database = typeof database === "function" ? database : () => database;
  }

  async listForUser(userId: number): Promise<TmuxMonitorListResult> {
    const rows = (
      await this.database().many(
        `SELECT * FROM tmux_monitors
         WHERE user_id = ?
         ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END,
           CASE WHEN status = 'active' THEN created_at ELSE completed_at END DESC,
           id DESC`,
        [userId],
      )
    ).map(mapMonitor);
    return {
      active: rows.filter((row) => row.status === "active"),
      history: rows.filter((row) => row.status !== "active").slice(0, HISTORY_LIMIT),
    };
  }

  async create(
    userId: number,
    hostId: number,
    pane: TmuxPaneSnapshot,
    thread: TmuxMonitorThreadBinding | null,
    mode: TmuxMonitorMode,
  ): Promise<StoredTmuxMonitor> {
    const now = new Date().toISOString();
    return await this.database().transaction(async (tx) => {
      const result = await tx.execute(
        `INSERT INTO tmux_monitors (
          user_id, host_id, project_id, thread_id, thread_title,
          session_name, session_id, session_created,
          window_index, window_name, pane_index, pane_id, pane_pid,
          initial_command, last_command, mode, status, created_at, run_started_at, last_checked_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
        [
          userId,
          hostId,
          thread?.projectId ?? null,
          thread?.threadId ?? null,
          thread?.threadTitle ?? null,
          pane.sessionName,
          pane.sessionId,
          pane.sessionCreated,
          pane.windowIndex,
          pane.windowName,
          pane.paneIndex,
          pane.paneId,
          pane.panePid,
          pane.currentCommand,
          pane.currentCommand,
          mode,
          now,
          mode === "once" || pane.running ? now : null,
          now,
        ],
      );
      return await requiredOwned(tx, userId, result.insertId);
    });
  }

  async getOwned(userId: number, id: number): Promise<StoredTmuxMonitor | null> {
    return await findOwned(this.database(), userId, id);
  }

  async pollGroups(): Promise<TmuxMonitorHostGroup[]> {
    const monitors = (
      await this.database().many(
        `SELECT * FROM tmux_monitors
         WHERE status = 'active' OR (status = 'completed' AND notification_sent_at IS NULL)
         ORDER BY user_id, host_id, id`,
      )
    ).map(mapMonitor);
    const groups = new Map<string, TmuxMonitorHostGroup>();
    for (const monitor of monitors) {
      const key = `${monitor.userId}:${monitor.hostId}`;
      const group = groups.get(key) ?? {
        userId: monitor.userId,
        hostId: monitor.hostId,
        monitors: [],
        pendingNotifications: [],
      };
      if (monitor.status === "active") group.monitors.push(monitor);
      else group.pendingNotifications.push(monitor);
      groups.set(key, group);
    }
    return Array.from(groups.values());
  }

  async activeForHost(userId: number, hostId: number): Promise<StoredTmuxMonitor[]> {
    return (
      await this.database().many(
        "SELECT * FROM tmux_monitors WHERE user_id = ? AND host_id = ? AND status = 'active' ORDER BY id",
        [userId, hostId],
      )
    ).map(mapMonitor);
  }

  async recordChecked(monitor: StoredTmuxMonitor, pane: TmuxPaneSnapshot): Promise<void> {
    const now = new Date().toISOString();
    await this.database().execute(
      `UPDATE tmux_monitors SET session_name = ?, session_id = ?, session_created = ?,
        window_index = ?, window_name = ?, pane_index = ?, pane_id = ?, pane_pid = ?,
        last_command = ?, last_checked_at = ?, last_error = NULL,
        last_error_at = NULL
       WHERE id = ? AND user_id = ? AND status = 'active' AND mode = ?
         AND run_started_at <=> ? AND last_checked_at <=> ?
         AND session_id = ? AND session_created = ? AND pane_id = ? AND pane_pid = ?`,
      [
        pane.sessionName,
        pane.sessionId,
        pane.sessionCreated,
        pane.windowIndex,
        pane.windowName,
        pane.paneIndex,
        pane.paneId,
        pane.panePid,
        pane.currentCommand,
        now,
        monitor.id,
        monitor.userId,
        monitor.mode,
        monitor.runStartedAt,
        monitor.lastCheckedAt,
        monitor.sessionId,
        monitor.sessionCreated,
        monitor.paneId,
        monitor.panePid,
      ],
    );
  }

  async recordWaitingCheck(monitor: StoredTmuxMonitor): Promise<void> {
    await this.database().execute(
      `UPDATE tmux_monitors SET last_checked_at = ?, last_error = NULL, last_error_at = NULL
       WHERE id = ? AND status = 'active' AND mode = 'permanent'`,
      [new Date().toISOString(), monitor.id],
    );
  }

  async startPermanentRun(monitor: StoredTmuxMonitor, pane: TmuxPaneSnapshot): Promise<void> {
    const now = new Date().toISOString();
    await this.database().execute(
      `UPDATE tmux_monitors SET session_id = ?, session_created = ?, window_name = ?,
        pane_id = ?, pane_pid = ?, initial_command = ?, last_command = ?, run_started_at = ?,
        last_checked_at = ?, last_error = NULL, last_error_at = NULL
       WHERE id = ? AND user_id = ? AND status = 'active' AND mode = 'permanent'
         AND run_started_at IS NULL AND run_started_at <=> ? AND last_checked_at <=> ?
         AND session_id = ? AND session_created = ? AND pane_id = ? AND pane_pid = ?`,
      [
        pane.sessionId,
        pane.sessionCreated,
        pane.windowName,
        pane.paneId,
        pane.panePid,
        pane.currentCommand,
        pane.currentCommand,
        now,
        now,
        monitor.id,
        monitor.userId,
        monitor.runStartedAt,
        monitor.lastCheckedAt,
        monitor.sessionId,
        monitor.sessionCreated,
        monitor.paneId,
        monitor.panePid,
      ],
    );
  }

  async recordHostError(userId: number, hostId: number, error: unknown): Promise<void> {
    const now = new Date().toISOString();
    await this.database().execute(
      `UPDATE tmux_monitors SET last_error = ?, last_error_at = ?
       WHERE user_id = ? AND host_id = ? AND status = 'active'`,
      [error instanceof Error ? error.message : String(error), now, userId, hostId],
    );
  }

  async complete(
    monitor: StoredTmuxMonitor,
    reason: Exclude<TmuxMonitorCompletionReason, "cancelled">,
    pane: TmuxPaneSnapshot | null,
  ): Promise<StoredTmuxMonitor | null> {
    const now = new Date().toISOString();
    return await this.database().transaction(async (tx) => {
      const result = await tx.execute(
        `UPDATE tmux_monitors SET status = 'completed', completion_reason = ?,
          session_name = ?, window_index = ?, window_name = ?, pane_index = ?,
          last_command = ?, last_checked_at = ?, completed_at = ?, last_error = NULL,
          last_error_at = NULL
         WHERE id = ? AND user_id = ? AND status = 'active' AND mode = 'once'`,
        [
          reason,
          pane?.sessionName ?? monitor.sessionName,
          pane?.windowIndex ?? monitor.windowIndex,
          pane?.windowName ?? monitor.windowName,
          pane?.paneIndex ?? monitor.paneIndex,
          pane?.currentCommand ?? monitor.lastCommand,
          now,
          now,
          monitor.id,
          monitor.userId,
        ],
      );
      if (result.affectedRows === 0) return null;
      await pruneHistory(tx, monitor.userId, monitor.hostId);
      return await findOwned(tx, monitor.userId, monitor.id);
    });
  }

  async completePermanentRun(
    monitor: StoredTmuxMonitor,
    reason: Exclude<TmuxMonitorCompletionReason, "cancelled">,
    pane: TmuxPaneSnapshot | null,
  ): Promise<StoredTmuxMonitor | null> {
    if (monitor.mode !== "permanent" || monitor.runStartedAt === null) return null;
    const now = new Date().toISOString();
    return await this.database().transaction(async (tx) => {
      const reset = await tx.execute(
        `UPDATE tmux_monitors SET session_id = ?, session_created = ?, window_name = ?,
          pane_id = ?, pane_pid = ?, last_command = ?, run_started_at = NULL,
          last_checked_at = ?, last_error = NULL, last_error_at = NULL
         WHERE id = ? AND user_id = ? AND status = 'active' AND mode = 'permanent'
           AND run_started_at = ? AND session_id = ? AND pane_id = ?`,
        [
          pane?.sessionId ?? monitor.sessionId,
          pane?.sessionCreated ?? monitor.sessionCreated,
          pane?.windowName ?? monitor.windowName,
          pane?.paneId ?? monitor.paneId,
          pane?.panePid ?? monitor.panePid,
          pane?.currentCommand ?? monitor.lastCommand,
          now,
          monitor.id,
          monitor.userId,
          monitor.runStartedAt,
          monitor.sessionId,
          monitor.paneId,
        ],
      );
      if (reset.affectedRows === 0) return null;
      const inserted = await tx.execute(
        `INSERT INTO tmux_monitors (
          user_id, host_id, project_id, thread_id, thread_title,
          session_name, session_id, session_created, window_index, window_name,
          pane_index, pane_id, pane_pid, initial_command, last_command, mode, status,
          completion_reason, created_at, run_started_at, last_checked_at, completed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'permanent', 'completed',
          ?, ?, ?, ?, ?)`,
        [
          monitor.userId,
          monitor.hostId,
          monitor.projectId,
          monitor.threadId,
          monitor.threadTitle,
          monitor.sessionName,
          monitor.sessionId,
          monitor.sessionCreated,
          monitor.windowIndex,
          monitor.windowName,
          monitor.paneIndex,
          monitor.paneId,
          monitor.panePid,
          monitor.initialCommand,
          pane?.currentCommand ?? monitor.lastCommand,
          reason,
          monitor.runStartedAt,
          monitor.runStartedAt,
          now,
          now,
        ],
      );
      await pruneHistory(tx, monitor.userId, monitor.hostId);
      return await findOwned(tx, monitor.userId, inserted.insertId);
    });
  }

  async promote(
    monitor: StoredTmuxMonitor,
    pane: TmuxPaneSnapshot | null,
  ): Promise<StoredTmuxMonitor | null> {
    const now = new Date().toISOString();
    return await this.database().transaction(async (tx) => {
      const result = await tx.execute(
        `UPDATE tmux_monitors SET mode = 'permanent', session_name = ?, session_id = ?,
          session_created = ?, window_index = ?, window_name = ?, pane_index = ?, pane_id = ?,
          pane_pid = ?, initial_command = ?, last_command = ?, run_started_at = ?, last_checked_at = ?,
          last_error = NULL, last_error_at = NULL
         WHERE id = ? AND user_id = ? AND status = 'active' AND mode = 'once'`,
        [
          pane?.sessionName ?? monitor.sessionName,
          pane?.sessionId ?? monitor.sessionId,
          pane?.sessionCreated ?? monitor.sessionCreated,
          pane?.windowIndex ?? monitor.windowIndex,
          pane?.windowName ?? monitor.windowName,
          pane?.paneIndex ?? monitor.paneIndex,
          pane?.paneId ?? monitor.paneId,
          pane?.panePid ?? monitor.panePid,
          pane?.currentCommand ?? monitor.initialCommand,
          pane?.currentCommand ?? monitor.lastCommand,
          pane?.running === true ? monitor.createdAt : null,
          now,
          monitor.id,
          monitor.userId,
        ],
      );
      if (result.affectedRows !== 1) return null;
      const promoted = await findOwned(tx, monitor.userId, monitor.id);
      if (promoted?.status !== "active" || promoted.mode !== "permanent") {
        throw new Error("Tmux monitor promotion was not persisted");
      }
      return promoted;
    });
  }

  async cancel(userId: number, id: number): Promise<StoredTmuxMonitor | null> {
    const now = new Date().toISOString();
    return await this.database().transaction(async (tx) => {
      const row = await tx.one(
        "SELECT * FROM tmux_monitors WHERE user_id = ? AND id = ? FOR UPDATE",
        [userId, id],
      );
      if (row === null) return null;
      const monitor = mapMonitor(row);
      if (monitor.status !== "active") return null;
      const result = await tx.execute(
        `UPDATE tmux_monitors SET status = 'cancelled', completion_reason = 'cancelled',
          completed_at = ?, last_checked_at = ? WHERE user_id = ? AND id = ? AND status = 'active'`,
        [now, now, userId, id],
      );
      if (result.affectedRows === 0) return null;
      await pruneHistory(tx, userId, monitor.hostId);
      return await findOwned(tx, userId, id);
    });
  }

  async markNotificationSent(userId: number, id: number): Promise<boolean> {
    const result = await this.database().execute(
      `UPDATE tmux_monitors SET notification_sent_at = ?
       WHERE user_id = ? AND id = ? AND notification_sent_at IS NULL`,
      [new Date().toISOString(), userId, id],
    );
    return result.affectedRows > 0;
  }

  async deleteHost(userId: number, hostId: number): Promise<void> {
    await this.database().execute("DELETE FROM tmux_monitors WHERE user_id = ? AND host_id = ?", [
      userId,
      hostId,
    ]);
  }
}

async function findOwned(
  db: GatewayDb,
  userId: number,
  id: number,
): Promise<StoredTmuxMonitor | null> {
  const row = await db.one("SELECT * FROM tmux_monitors WHERE user_id = ? AND id = ?", [
    userId,
    id,
  ]);
  return row === null ? null : mapMonitor(row);
}

async function requiredOwned(db: GatewayDb, userId: number, id: number) {
  const monitor = await findOwned(db, userId, id);
  if (monitor === null) throw new Error("Tmux monitor was not recorded");
  return monitor;
}

async function pruneHistory(db: GatewayDb, userId: number, hostId: number): Promise<void> {
  const row = await db.one<{ count: number }>(
    `SELECT COUNT(*) AS count FROM tmux_monitors
     WHERE user_id = ? AND host_id = ? AND status != 'active'
       AND (status = 'cancelled' OR notification_sent_at IS NOT NULL)`,
    [userId, hostId],
  );
  const excess = Number(row?.count ?? 0) - HISTORY_LIMIT;
  if (excess <= 0) return;
  const rows = await db.many<{ id: number }>(
    `SELECT id FROM tmux_monitors
     WHERE user_id = ? AND host_id = ? AND status != 'active'
       AND (status = 'cancelled' OR notification_sent_at IS NOT NULL)
     ORDER BY completed_at ASC, id ASC
     LIMIT ?`,
    [userId, hostId, excess],
  );
  const ids = rows.map((entry) => Number(entry.id));
  if (ids.length === 0) return;
  await db.execute(
    `DELETE FROM tmux_monitors
     WHERE user_id = ? AND host_id = ? AND id IN (${ids.map(() => "?").join(", ")})`,
    [userId, hostId, ...ids],
  );
}

function mapMonitor(row: Record<string, unknown>): StoredTmuxMonitor {
  return {
    id: Number(row.id),
    userId: Number(row.user_id),
    hostId: Number(row.host_id),
    projectId: optionalInteger(row.project_id),
    threadId: optionalText(row.thread_id),
    threadTitle: optionalText(row.thread_title),
    sessionName: String(row.session_name),
    sessionId: String(row.session_id),
    sessionCreated: Number(row.session_created),
    windowIndex: Number(row.window_index),
    windowName: String(row.window_name),
    paneIndex: Number(row.pane_index),
    paneId: String(row.pane_id),
    panePid: Number(row.pane_pid),
    initialCommand: String(row.initial_command),
    lastCommand: String(row.last_command),
    mode: tmuxMonitorModeSchema.parse(row.mode),
    status: tmuxMonitorStatusSchema.parse(row.status),
    completionReason: tmuxMonitorCompletionReasonSchema
      .nullable()
      .parse(optionalText(row.completion_reason)),
    createdAt: String(row.created_at),
    runStartedAt: optionalText(row.run_started_at),
    lastCheckedAt: optionalText(row.last_checked_at),
    completedAt: optionalText(row.completed_at),
    lastError: optionalText(row.last_error),
    lastErrorAt: optionalText(row.last_error_at),
    notificationSentAt: optionalText(row.notification_sent_at),
  };
}

function optionalText(value: unknown) {
  return typeof value === "string" && value !== "" ? value : null;
}

function optionalInteger(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}
