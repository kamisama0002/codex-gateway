import { describe, expect, it } from "vitest";
import { buildAgentMetricsSample } from "./agent-sample";

const current = {
  sampledAtMs: 2_000,
  cpuUsage: 2_000_000_000,
  systemCpuUsage: 10_000_000_000,
  preCpuUsage: 1_000_000_000,
  preSystemCpuUsage: 8_000_000_000,
  onlineCpus: 2,
  memoryUsageBytes: 256,
  memoryLimitBytes: 1_024,
  rxBytes: 8_000,
  txBytes: 4_000,
  diskReadBytes: 200,
  diskWriteBytes: 100,
  interfaces: ["eth0"],
  cpuQuotaCpus: 2,
};

describe("buildAgentMetricsSample", () => {
  it("computes CPU from the docker precpu snapshot and rates from the previous sample", () => {
    const previous = {
      ...current,
      sampledAtMs: 1_000,
      rxBytes: 6_000,
      txBytes: 3_000,
      diskReadBytes: 100,
      diskWriteBytes: 50,
    };

    expect(buildAgentMetricsSample(current, previous)).toEqual({
      sampledAt: new Date(2_000).toISOString(),
      cpu: { usagePercent: 100, loadAverage: [2, 0, 0] },
      memory: {
        totalBytes: 1_024,
        usedBytes: 256,
        availableBytes: 768,
        usagePercent: 25,
      },
      network: {
        receiveBytesPerSecond: 2_000,
        transmitBytesPerSecond: 1_000,
        interfaces: ["eth0"],
      },
      disk: {
        readBytesPerSecond: 100,
        writeBytesPerSecond: 50,
        filesystems: [],
      },
      gpus: [],
    });
  });

  it("falls back to the previous sample when Docker omits precpu stats", () => {
    const previous = {
      ...current,
      sampledAtMs: 1_000,
      cpuUsage: 1_000_000_000,
      systemCpuUsage: 8_000_000_000,
    };
    const withoutPrecpu = {
      ...current,
      preCpuUsage: 0,
      preSystemCpuUsage: 0,
    };

    expect(buildAgentMetricsSample(withoutPrecpu, previous).cpu.usagePercent).toBe(100);
    expect(buildAgentMetricsSample(withoutPrecpu, null).cpu.usagePercent).toBeNull();
  });
});
