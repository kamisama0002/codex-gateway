import type {
  HostMetricsCollectorStatus,
  HostMetricsSample,
  HostMetricsSnapshot,
} from "~~/shared/types";
import { MANAGED_RUNTIME_HOST_ID } from "~~/shared/runtime/managed-runtime";
import type { AgentRuntimeStatsResult } from "../runtime-manager/client";
import { AgentMetricsCollector } from "./agent-collector";
import { HostMetricsEventBus } from "./events";

const MAX_SAMPLES = 300;

interface HostMetricsRuntime {
  collector: AgentMetricsCollector;
  status: HostMetricsCollectorStatus;
  message: string | null;
  samples: HostMetricsSample[];
}

export class HostMetricsManager {
  readonly events = new HostMetricsEventBus();
  private runtimes = new Map<string, HostMetricsRuntime>();

  constructor(private readonly sampleAgent: (userId: number) => Promise<AgentRuntimeStatsResult>) {}

  snapshot(userId: number, hostId: number): HostMetricsSnapshot {
    const runtime = this.runtimes.get(runtimeKey(userId, hostId));
    return {
      hostId,
      status: runtime?.status ?? "waiting",
      message: runtime?.message ?? null,
      samples: runtime?.samples.slice() ?? [],
      gpuProcesses: null,
    };
  }

  ensureCollector(userId: number) {
    const hostId = MANAGED_RUNTIME_HOST_ID;
    const key = runtimeKey(userId, hostId);
    const existing = this.runtimes.get(key);
    if (existing !== undefined) {
      existing.collector.start();
      return;
    }

    const collector = new AgentMetricsCollector(() => this.sampleAgent(userId), {
      sample: (sample) => this.acceptSample(userId, hostId, sample),
      disconnected: (message) => this.setStatus(userId, hostId, "disconnected", message),
      error: (message) => this.setStatus(userId, hostId, "error", message),
    });
    this.runtimes.set(key, {
      status: "waiting",
      message: null,
      samples: [],
      collector,
    });
    collector.start();
  }

  removeHost(userId: number, hostId: number) {
    const key = runtimeKey(userId, hostId);
    this.runtimes.get(key)?.collector.stop();
    this.runtimes.delete(key);
  }

  private acceptSample(userId: number, hostId: number, sample: HostMetricsSample) {
    const runtime = this.runtimes.get(runtimeKey(userId, hostId));
    if (runtime === undefined) return;
    runtime.samples.push(sample);
    if (runtime.samples.length > MAX_SAMPLES)
      runtime.samples.splice(0, runtime.samples.length - MAX_SAMPLES);
    runtime.status = "collecting";
    runtime.message = null;
    this.events.publish(userId, hostId, {
      type: "sample",
      hostId,
      sample,
      gpuProcesses: null,
    });
  }

  private setStatus(
    userId: number,
    hostId: number,
    status: HostMetricsCollectorStatus,
    message: string | null,
  ) {
    const runtime = this.runtimes.get(runtimeKey(userId, hostId));
    if (runtime === undefined) return;
    runtime.status = status;
    runtime.message = message;
    this.events.publish(userId, hostId, {
      type: "status",
      snapshot: this.snapshot(userId, hostId),
    });
  }
}

function runtimeKey(userId: number, hostId: number) {
  return `${userId}:${hostId}`;
}
