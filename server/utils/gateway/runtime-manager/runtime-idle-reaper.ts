import { runtimeService } from "./runtime-service";
import { runtimeIdleTimeoutMs } from "./runtime-idle-timeout";

const MAX_SWEEP_INTERVAL_MS = 5 * 60_000;
const MIN_SWEEP_INTERVAL_MS = 60_000;

export class RuntimeIdleReaper {
  private timer: ReturnType<typeof setInterval> | null = null;
  private active = false;

  constructor(
    private readonly options: {
      idleTimeoutMs: number;
      releaseIdleRuntimes: () => Promise<number[]>;
      intervalMs?: number;
    },
  ) {}

  start() {
    if (this.timer !== null) return;
    const intervalMs =
      this.options.intervalMs ??
      Math.min(
        MAX_SWEEP_INTERVAL_MS,
        Math.max(MIN_SWEEP_INTERVAL_MS, Math.floor(this.options.idleTimeoutMs / 2)),
      );
    this.timer = setInterval(() => void this.sweep(), intervalMs);
    this.timer.unref?.();
    void this.sweep();
  }

  stop() {
    if (this.timer === null) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  async sweep() {
    // The service applies the global timeout only when a tenant has no override.
    // Always sweep so tenant policies can enable recycling when the global default is 0.
    if (this.active) return [];
    this.active = true;
    try {
      const released = await this.options.releaseIdleRuntimes();
      if (released.length > 0) {
        console.info("[gateway-runtime] released idle runtimes", { userIds: released });
      }
      return released;
    } finally {
      this.active = false;
    }
  }
}

export const runtimeIdleReaper = new RuntimeIdleReaper({
  idleTimeoutMs: runtimeIdleTimeoutMs(),
  releaseIdleRuntimes: () => runtimeService.releaseIdleRuntimes(),
});
