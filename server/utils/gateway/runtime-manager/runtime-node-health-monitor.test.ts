import { afterEach, describe, expect, it, vi } from "vitest";
import type { RuntimeNodeRecord } from "./runtime-node-types";
import { RuntimeNodeHealthMonitor } from "./runtime-node-health-monitor";

const timestamp = "2026-09-08T00:00:00.000Z";
const nextTimestamp = "2026-09-08T00:00:10.000Z";

afterEach(() => {
  vi.useRealTimers();
});

describe("runtime node health monitor", () => {
  it("probes active and draining nodes, skips disabled nodes, and stores safe health JSON", async () => {
    const nodes = [
      node("node__active"),
      node("node__draining", "draining"),
      node("node__disabled", "disabled"),
    ];
    const updates: Array<{ nodeId: string; health: Record<string, unknown> }> = [];
    const requested: string[] = [];
    const monitor = new RuntimeNodeHealthMonitor({
      nodeStore: {
        list: async () => nodes,
        updateHealth: async (nodeId, health) => {
          updates.push({ nodeId, health });
        },
      },
      clients: {
        get: async (nodeId) => ({
          status: async () => {
            requested.push(nodeId);
            return health(nodeId);
          },
        }),
      },
      now: () => nextTimestamp,
    });

    await monitor.probeNow();

    expect(requested).toEqual(["node__active", "node__draining"]);
    expect(updates).toHaveLength(2);
    for (const update of updates) {
      expect(update.health).toMatchObject({ lastSeenAt: nextTimestamp, lastError: null });
      expect(JSON.parse(String(update.health.healthJson))).toMatchObject({
        nodeId: update.nodeId,
        availableDiskBytes: 100 * 1024 * 1024 * 1024,
      });
    }
  });

  it("preserves the last successful timestamp on failure and stops scheduled probes", async () => {
    vi.useFakeTimers();
    const updateHealth = vi.fn(async () => undefined);
    const status = vi
      .fn<() => Promise<ReturnType<typeof health>>>()
      .mockRejectedValue(
        Object.assign(new Error("private detail"), { code: "runtime_manager_timeout" }),
      );
    const monitor = new RuntimeNodeHealthMonitor({
      nodeStore: { list: async () => [node("node__a")], updateHealth },
      clients: { get: async () => ({ status }) },
      now: () => nextTimestamp,
      intervalMs: 10_000,
    });

    monitor.start();
    await vi.waitFor(() => expect(status).toHaveBeenCalledOnce());
    await vi.advanceTimersByTimeAsync(10_000);
    expect(status).toHaveBeenCalledTimes(2);
    monitor.stop();
    await vi.advanceTimersByTimeAsync(20_000);

    expect(status).toHaveBeenCalledTimes(2);
    expect(updateHealth).toHaveBeenLastCalledWith("node__a", {
      lastSeenAt: timestamp,
      lastError: "runtime_manager_timeout",
      healthJson: null,
    });
  });
});

function node(
  id: string,
  schedulingState: RuntimeNodeRecord["schedulingState"] = "active",
): RuntimeNodeRecord {
  return {
    id,
    name: id,
    baseUrl: `https://${id}.runtime.internal`,
    encryptedSharedSecret: "encrypted",
    configRevision: 1,
    schedulingState,
    capacityCpuMillis: 16_000,
    capacityMemoryBytes: 64 * 1024 * 1024 * 1024,
    maxRuntimes: 30,
    minimumFreeDiskBytes: 20 * 1024 * 1024 * 1024,
    lastSeenAt: timestamp,
    lastError: null,
    healthJson: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function health(nodeId: string) {
  return {
    nodeId,
    protocolVersion: 1 as const,
    managerVersion: "0.153.4",
    sampledAt: nextTimestamp,
    capacityCpuMillis: 16_000,
    capacityMemoryBytes: 64 * 1024 * 1024 * 1024,
    maxRuntimes: 30,
    dockerAvailable: true,
    dataRootWritable: true,
    availableDiskBytes: 100 * 1024 * 1024 * 1024,
    totalDiskBytes: 200 * 1024 * 1024 * 1024,
    managedRuntimeCount: 2,
    runningRuntimeCount: 1,
    agentImages: { stable: "0.153.4" },
  };
}
