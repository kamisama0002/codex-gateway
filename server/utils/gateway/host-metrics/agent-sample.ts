import type { HostMetricsSample } from "~~/shared/types";
import type { AgentRuntimeStatsResult } from "../runtime-manager/client";

type AgentContainerStats = NonNullable<AgentRuntimeStatsResult["stats"]>;

export function buildAgentMetricsSample(
  current: AgentContainerStats,
  previous: AgentContainerStats | null,
): HostMetricsSample {
  const elapsedSeconds =
    previous === null ? null : (current.sampledAtMs - previous.sampledAtMs) / 1_000;
  const memoryUsedBytes = Math.min(current.memoryUsageBytes, current.memoryLimitBytes);
  return {
    sampledAt: new Date(current.sampledAtMs).toISOString(),
    cpu: {
      usagePercent: dockerCpuPercent(current, previous),
      loadAverage: [current.cpuQuotaCpus, 0, 0],
    },
    memory: {
      totalBytes: current.memoryLimitBytes,
      usedBytes: memoryUsedBytes,
      availableBytes: Math.max(0, current.memoryLimitBytes - memoryUsedBytes),
      usagePercent:
        current.memoryLimitBytes > 0 ? (memoryUsedBytes / current.memoryLimitBytes) * 100 : 0,
    },
    network: {
      receiveBytesPerSecond: rate(current.rxBytes, previous?.rxBytes, elapsedSeconds),
      transmitBytesPerSecond: rate(current.txBytes, previous?.txBytes, elapsedSeconds),
      interfaces: current.interfaces,
    },
    disk: {
      readBytesPerSecond: rate(current.diskReadBytes, previous?.diskReadBytes, elapsedSeconds),
      writeBytesPerSecond: rate(current.diskWriteBytes, previous?.diskWriteBytes, elapsedSeconds),
      filesystems: [],
    },
    gpus: [],
  };
}

function dockerCpuPercent(stats: AgentContainerStats, previous: AgentContainerStats | null) {
  const hasPrecpu = stats.preCpuUsage > 0 && stats.preSystemCpuUsage > 0;
  const previousCpu = hasPrecpu ? stats.preCpuUsage : previous?.cpuUsage;
  const previousSystem = hasPrecpu ? stats.preSystemCpuUsage : previous?.systemCpuUsage;
  if (previousCpu === undefined || previousSystem === undefined) return null;
  const cpuDelta = stats.cpuUsage - previousCpu;
  const systemDelta = stats.systemCpuUsage - previousSystem;
  if (cpuDelta < 0 || systemDelta <= 0) return null;
  return clampPercent((cpuDelta / systemDelta) * stats.onlineCpus * 100);
}

function rate(current: number, previous: number | undefined, elapsedSeconds: number | null) {
  if (
    previous === undefined ||
    elapsedSeconds === null ||
    elapsedSeconds <= 0 ||
    current < previous
  )
    return null;
  return (current - previous) / elapsedSeconds;
}

function clampPercent(value: number) {
  return Math.min(100, Math.max(0, value));
}
