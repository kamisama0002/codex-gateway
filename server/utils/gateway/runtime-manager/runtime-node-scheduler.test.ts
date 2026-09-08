import { describe, expect, it } from "vitest";
import type { RuntimeNodeRecord } from "./runtime-node-types";
import { RuntimePlacementError, scheduleRuntimeNode } from "./runtime-node-scheduler";

const GIB = 1024 * 1024 * 1024;
const now = Date.parse("2026-09-08T00:00:00.000Z");

describe("runtime node scheduler", () => {
  it("uses the stable node id when eligible nodes have equal remaining capacity", () => {
    const selected = scheduleRuntimeNode({
      requested: { cpuMillis: 5_000, memoryBytes: 10 * GIB, pids: 1_024 },
      nodes: [candidate("node__b"), candidate("node__a")],
      reservations: new Map(),
      nowMs: now,
      freshnessMs: 30_000,
    });

    expect(selected.id).toBe("node__a");
  });

  it("scores the post-placement bottleneck instead of one abundant resource", () => {
    const selected = scheduleRuntimeNode({
      requested: { cpuMillis: 5_000, memoryBytes: 10 * GIB, pids: 1_024 },
      nodes: [candidate("node__cpu-heavy"), candidate("node__balanced")],
      reservations: new Map([
        ["node__cpu-heavy", { cpuMillis: 0, memoryBytes: 45 * GIB, runtimes: 1 }],
        ["node__balanced", { cpuMillis: 8_000, memoryBytes: 20 * GIB, runtimes: 2 }],
      ]),
      nowMs: now,
      freshnessMs: 30_000,
    });

    expect(selected.id).toBe("node__balanced");
  });

  it("rejects draining, stale, full, and disk-unsafe nodes", () => {
    const nodes = [
      candidate("node__draining", { schedulingState: "draining" }),
      candidate("node__stale", { lastSeenAt: "2026-09-07T23:58:00.000Z" }),
      candidate("node__disk", { availableDiskBytes: 10 * GIB }),
      candidate("node__full"),
    ];
    const reservations = new Map([
      ["node__full", { cpuMillis: 30_000, memoryBytes: 60 * GIB, runtimes: 30 }],
    ]);

    expect(() =>
      scheduleRuntimeNode({
        requested: { cpuMillis: 5_000, memoryBytes: 10 * GIB, pids: 1_024 },
        nodes,
        reservations,
        nowMs: now,
        freshnessMs: 30_000,
      }),
    ).toThrow(new RuntimePlacementError("runtime_node_capacity_unavailable"));
  });
});

function candidate(
  id: string,
  overrides: Partial<RuntimeNodeRecord> & { availableDiskBytes?: number } = {},
) {
  const { availableDiskBytes = 100 * GIB, ...recordOverrides } = overrides;
  return {
    node: {
      id,
      name: id,
      baseUrl: `http://${id}.internal:8787`,
      encryptedSharedSecret: "v1$encrypted",
      configRevision: 1,
      schedulingState: "active" as const,
      capacityCpuMillis: 32_000,
      capacityMemoryBytes: 64 * GIB,
      maxRuntimes: 30,
      minimumFreeDiskBytes: 20 * GIB,
      lastSeenAt: "2026-09-08T00:00:00.000Z",
      lastError: null,
      healthJson: null,
      createdAt: "2026-09-08T00:00:00.000Z",
      updatedAt: "2026-09-08T00:00:00.000Z",
      ...recordOverrides,
    },
    availableDiskBytes,
  };
}
