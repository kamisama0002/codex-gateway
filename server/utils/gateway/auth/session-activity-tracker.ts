import type { GatewayDb } from "../storage/contracts";
import { gatewayMysqlDatabase } from "../storage/mysql-database";

const LAST_SEEN_WRITE_INTERVAL_MS = 5 * 60_000;
const MAX_TRACKED_SESSIONS = 10_000;

type DatabaseProvider = () => GatewayDb;

/**
 * Authentication still validates MySQL on every request. Only the ancillary last_seen_at write
 * is coalesced so high-frequency file, terminal and realtime traffic does not create a write
 * transaction per request.
 */
export class SessionActivityTracker {
  private readonly lastWrittenAt = new Map<string, number>();
  private readonly inFlight = new Map<string, Promise<void>>();

  constructor(
    private readonly database: DatabaseProvider = gatewayMysqlDatabase,
    private readonly maxTrackedSessions = MAX_TRACKED_SESSIONS,
  ) {}

  touch(tokenHash: string): void {
    const now = Date.now();
    const previous = this.lastWrittenAt.get(tokenHash);
    if (previous !== undefined && now - previous < LAST_SEEN_WRITE_INTERVAL_MS) return;
    if (this.inFlight.has(tokenHash)) return;
    if (this.inFlight.size >= this.maxTrackedSessions) return;

    const request = this.write(tokenHash, now);
    const tracked = request.finally(() => {
      if (this.inFlight.get(tokenHash) === tracked) this.inFlight.delete(tokenHash);
    });
    this.inFlight.set(tokenHash, tracked);
  }

  forget(tokenHash: string): void {
    this.lastWrittenAt.delete(tokenHash);
  }

  private async write(tokenHash: string, now: number): Promise<void> {
    try {
      const result = await this.database().execute(
        "UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?",
        [new Date(now).toISOString(), tokenHash],
      );
      if (result.affectedRows > 0) {
        this.lastWrittenAt.set(tokenHash, now);
        this.prune(now);
      } else {
        this.lastWrittenAt.delete(tokenHash);
      }
    } catch (error) {
      this.lastWrittenAt.delete(tokenHash);
      console.warn("[gateway-auth] failed to record session activity", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private prune(now: number): void {
    if (this.lastWrittenAt.size <= this.maxTrackedSessions) return;
    for (const [tokenHash, writtenAt] of this.lastWrittenAt) {
      if (now - writtenAt >= LAST_SEEN_WRITE_INTERVAL_MS) this.lastWrittenAt.delete(tokenHash);
      if (this.lastWrittenAt.size <= this.maxTrackedSessions) return;
    }
    this.lastWrittenAt.delete(this.lastWrittenAt.keys().next().value!);
  }
}

export const sessionActivityTracker = new SessionActivityTracker();
