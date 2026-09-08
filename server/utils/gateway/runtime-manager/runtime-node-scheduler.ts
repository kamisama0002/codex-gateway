import type { RuntimeNodeRecord } from "./runtime-node-types";

export interface RuntimeNodeReservation {
  cpuMillis: number;
  memoryBytes: number;
  runtimes: number;
}

export interface RuntimeNodeSchedulingCandidate {
  node: RuntimeNodeRecord;
  availableDiskBytes: number;
}

export interface RuntimePlacementResources {
  cpuMillis: number;
  memoryBytes: number;
  pids: number;
}

export class RuntimePlacementError extends Error {
  constructor(readonly code: "runtime_node_capacity_unavailable") {
    super(code);
    this.name = "RuntimePlacementError";
  }
}

export function scheduleRuntimeNode(input: {
  requested: RuntimePlacementResources;
  nodes: RuntimeNodeSchedulingCandidate[];
  reservations: ReadonlyMap<string, RuntimeNodeReservation>;
  nowMs: number;
  freshnessMs: number;
}): RuntimeNodeRecord {
  const candidates = input.nodes
    .flatMap((candidate) => {
      const score = scoreCandidate(
        candidate,
        input.reservations.get(candidate.node.id) ?? emptyReservation,
        input.requested,
        input.nowMs,
        input.freshnessMs,
      );
      return score === null ? [] : [{ ...candidate, score }];
    })
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.availableDiskBytes - left.availableDiskBytes ||
        left.node.id.localeCompare(right.node.id),
    );
  const selected = candidates[0];
  if (selected === undefined) {
    throw new RuntimePlacementError("runtime_node_capacity_unavailable");
  }
  return selected.node;
}

const emptyReservation: RuntimeNodeReservation = {
  cpuMillis: 0,
  memoryBytes: 0,
  runtimes: 0,
};

function scoreCandidate(
  candidate: RuntimeNodeSchedulingCandidate,
  reserved: RuntimeNodeReservation,
  requested: RuntimePlacementResources,
  nowMs: number,
  freshnessMs: number,
) {
  const node = candidate.node;
  if (
    node.schedulingState !== "active" ||
    node.lastError !== null ||
    !isFresh(node.lastSeenAt, nowMs, freshnessMs) ||
    candidate.availableDiskBytes < node.minimumFreeDiskBytes
  ) {
    return null;
  }
  const cpuRemaining = node.capacityCpuMillis - reserved.cpuMillis - requested.cpuMillis;
  const memoryRemaining = node.capacityMemoryBytes - reserved.memoryBytes - requested.memoryBytes;
  const runtimeRemaining = node.maxRuntimes - reserved.runtimes - 1;
  if (cpuRemaining < 0 || memoryRemaining < 0 || runtimeRemaining < 0) return null;
  return Math.min(
    cpuRemaining / node.capacityCpuMillis,
    memoryRemaining / node.capacityMemoryBytes,
    runtimeRemaining / node.maxRuntimes,
  );
}

function isFresh(lastSeenAt: string | null, nowMs: number, freshnessMs: number) {
  if (lastSeenAt === null || !Number.isFinite(nowMs) || freshnessMs <= 0) return false;
  const lastSeenMs = Date.parse(lastSeenAt);
  if (!Number.isFinite(lastSeenMs)) return false;
  const age = nowMs - lastSeenMs;
  return age >= -freshnessMs && age <= freshnessMs;
}
