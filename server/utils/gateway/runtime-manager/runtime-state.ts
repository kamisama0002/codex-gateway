import type { RuntimeStatus } from "@codex-gateway/agent-runtime-contracts";

export type RuntimeEvent =
  | "provision"
  | "provisionFailed"
  | "start"
  | "schemaCheck"
  | "schemaOk"
  | "schemaMismatch"
  | "capabilitiesOk"
  | "runtimeFailed"
  | "restart"
  | "restartFailed"
  | "remove";

type RuntimeTransitionTable = {
  [Status in RuntimeStatus]: Partial<Record<RuntimeEvent, RuntimeStatus>>;
};

const runtimeTransitions: RuntimeTransitionTable = {
  absent: { provision: "provisioning" },
  provisioning: { start: "schema_checking", provisionFailed: "degraded", remove: "absent" },
  starting: { schemaCheck: "schema_checking", runtimeFailed: "degraded", remove: "absent" },
  schema_checking: {
    schemaOk: "syncing_capabilities",
    schemaMismatch: "incompatible",
    runtimeFailed: "degraded",
    remove: "absent",
  },
  syncing_capabilities: {
    capabilitiesOk: "ready",
    schemaMismatch: "incompatible",
    runtimeFailed: "degraded",
    remove: "absent",
  },
  ready: { runtimeFailed: "degraded", restart: "restarting", remove: "absent" },
  degraded: { restart: "restarting", provision: "provisioning", remove: "absent" },
  restarting: { start: "schema_checking", restartFailed: "degraded", remove: "absent" },
  incompatible: { provision: "provisioning", remove: "absent" },
};

export class RuntimeTransitionError extends Error {
  constructor(
    public readonly current: RuntimeStatus,
    public readonly event: RuntimeEvent,
  ) {
    super(`Runtime cannot transition from ${current} with ${event}`);
    this.name = "RuntimeTransitionError";
  }
}

export function transitionRuntime(current: RuntimeStatus, event: RuntimeEvent): RuntimeStatus {
  const next = runtimeTransitions[current][event];
  if (next === undefined) throw new RuntimeTransitionError(current, event);
  return next;
}

export function reduceRuntimeEvents(
  current: RuntimeStatus,
  events: readonly RuntimeEvent[],
): RuntimeStatus {
  return events.reduce(transitionRuntime, current);
}
