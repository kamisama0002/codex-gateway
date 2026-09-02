import { describe, expect, it } from "vitest";
import { parseDockerContainerStats } from "./container-stats.js";

export const dockerStatsFixture = {
  read: "2026-09-02T07:00:00.000Z",
  cpu_stats: {
    cpu_usage: { total_usage: 2_000_000_000 },
    system_cpu_usage: 10_000_000_000,
    online_cpus: 2,
  },
  precpu_stats: {
    cpu_usage: { total_usage: 1_000_000_000 },
    system_cpu_usage: 8_000_000_000,
  },
  memory_stats: {
    usage: 256 * 1024 * 1024,
    limit: 2 * 1024 * 1024 * 1024,
    stats: { inactive_file: 16 * 1024 * 1024 },
  },
  networks: {
    eth0: { rx_bytes: 4_096, tx_bytes: 2_048 },
  },
  blkio_stats: {
    io_service_bytes_recursive: [
      { op: "Read", value: 512 },
      { op: "Write", value: 256 },
    ],
  },
};

describe("parseDockerContainerStats", () => {
  it("maps docker stats without exposing container identity", () => {
    expect(parseDockerContainerStats(dockerStatsFixture)).toEqual({
      sampledAtMs: Date.parse("2026-09-02T07:00:00.000Z"),
      cpuUsage: 2_000_000_000,
      systemCpuUsage: 10_000_000_000,
      preCpuUsage: 1_000_000_000,
      preSystemCpuUsage: 8_000_000_000,
      onlineCpus: 2,
      memoryUsageBytes: 240 * 1024 * 1024,
      memoryLimitBytes: 2 * 1024 * 1024 * 1024,
      rxBytes: 4_096,
      txBytes: 2_048,
      diskReadBytes: 512,
      diskWriteBytes: 256,
      interfaces: ["eth0"],
    });
  });
});
