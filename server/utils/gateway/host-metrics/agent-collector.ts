import type { HostMetricsSample } from "~~/shared/types";
import type { AgentRuntimeStatsResult } from "../runtime-manager/client";
import { AdaptivePollSchedule } from "../infra/background/adaptive-poll-schedule";
import { buildAgentMetricsSample } from "./agent-sample";

const MIN_SAMPLE_DELAY_MS = 2_000;
const MAX_SAMPLE_DELAY_MS = 30_000;
const FAILURE_DELAYS_MS = [5_000, 10_000, 20_000, 30_000] as const;

export interface AgentMetricsCollectorCallbacks {
  sample: (sample: HostMetricsSample) => void;
  disconnected: (message: string | null) => void;
  error: (message: string) => void;
}

type AgentContainerStats = NonNullable<AgentRuntimeStatsResult["stats"]>;

export class AgentMetricsCollector {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private previous: AgentContainerStats | null = null;
  private readonly schedulePolicy = new AdaptivePollSchedule({
    minimumDelayMs: MIN_SAMPLE_DELAY_MS,
    maximumDelayMs: MAX_SAMPLE_DELAY_MS,
    failureDelaysMs: FAILURE_DELAYS_MS,
  });

  constructor(
    private readonly sampleStats: () => Promise<AgentRuntimeStatsResult>,
    private readonly callbacks: AgentMetricsCollectorCallbacks,
  ) {}

  start() {
    if (this.running) return;
    this.running = true;
    void this.collect();
  }

  stop() {
    this.running = false;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private async collect() {
    if (!this.running) return;
    const startedAt = Date.now();
    try {
      const result = await this.sampleStats();
      if (!this.running) return;
      if (result.status !== "running" || result.stats === null) {
        this.previous = null;
        this.callbacks.disconnected(
          result.status === "absent"
            ? "Agent runtime is not provisioned"
            : "Agent runtime is not running",
        );
        this.schedule(this.schedulePolicy.afterFailure());
        return;
      }
      const sample = buildAgentMetricsSample(result.stats, this.previous);
      this.previous = result.stats;
      this.callbacks.sample(sample);
      this.schedule(this.schedulePolicy.afterSuccess(Date.now() - startedAt));
    } catch (error: unknown) {
      if (!this.running) return;
      this.callbacks.error(error instanceof Error ? error.message : "Agent metrics sample failed");
      this.schedule(this.schedulePolicy.afterFailure());
    }
  }

  private schedule(delayMs: number) {
    if (!this.running || this.timer !== null) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.collect();
    }, delayMs);
  }
}
