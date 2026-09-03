import { runtimeStatusSchema, type RuntimeStatus } from "@codex-gateway/agent-runtime-contracts";

export const runtimeStatuses = runtimeStatusSchema.options;
export const runtimeEvents = [
  "provision",
  "provisionFailed",
  "start",
  "schemaCheck",
  "schemaOk",
  "schemaMismatch",
  "capabilitiesOk",
  "runtimeFailed",
  "restart",
  "restartFailed",
  "remove",
] as const;
export type RuntimeEvent = (typeof runtimeEvents)[number];

type RuntimeTransitionTable = Record<RuntimeStatus, Record<RuntimeEvent, RuntimeStatus | null>>;

export const runtimeTransitionMatrix: RuntimeTransitionTable = {
  absent: {
    provision: "provisioning",
    provisionFailed: null,
    start: null,
    schemaCheck: null,
    schemaOk: null,
    schemaMismatch: null,
    capabilitiesOk: null,
    runtimeFailed: null,
    restart: null,
    restartFailed: null,
    remove: null,
  },
  provisioning: {
    provision: null,
    provisionFailed: "degraded",
    start: "schema_checking",
    schemaCheck: null,
    schemaOk: null,
    schemaMismatch: null,
    capabilitiesOk: null,
    runtimeFailed: null,
    restart: null,
    restartFailed: null,
    remove: "absent",
  },
  starting: {
    provision: null,
    provisionFailed: null,
    start: null,
    schemaCheck: "schema_checking",
    schemaOk: null,
    schemaMismatch: null,
    capabilitiesOk: null,
    runtimeFailed: "degraded",
    restart: null,
    restartFailed: null,
    remove: "absent",
  },
  schema_checking: {
    provision: null,
    provisionFailed: null,
    start: null,
    schemaCheck: null,
    schemaOk: "syncing_capabilities",
    schemaMismatch: "incompatible",
    capabilitiesOk: null,
    runtimeFailed: "degraded",
    restart: null,
    restartFailed: null,
    remove: "absent",
  },
  syncing_capabilities: {
    provision: null,
    provisionFailed: null,
    start: null,
    schemaCheck: null,
    schemaOk: null,
    capabilitiesOk: "ready",
    schemaMismatch: "incompatible",
    runtimeFailed: "degraded",
    restart: null,
    restartFailed: null,
    remove: "absent",
  },
  ready: {
    provision: null,
    provisionFailed: null,
    start: null,
    schemaCheck: null,
    schemaOk: null,
    schemaMismatch: null,
    capabilitiesOk: null,
    runtimeFailed: "degraded",
    restart: "restarting",
    restartFailed: null,
    remove: "absent",
  },
  degraded: {
    provision: "provisioning",
    provisionFailed: null,
    start: null,
    schemaCheck: null,
    schemaOk: null,
    schemaMismatch: null,
    capabilitiesOk: null,
    runtimeFailed: null,
    restart: "restarting",
    restartFailed: null,
    remove: "absent",
  },
  restarting: {
    provision: null,
    provisionFailed: null,
    start: "schema_checking",
    schemaCheck: null,
    schemaOk: null,
    schemaMismatch: null,
    capabilitiesOk: null,
    runtimeFailed: null,
    restart: null,
    restartFailed: "degraded",
    remove: "absent",
  },
  incompatible: {
    provision: "provisioning",
    provisionFailed: null,
    start: null,
    schemaCheck: null,
    schemaOk: null,
    schemaMismatch: null,
    capabilitiesOk: null,
    runtimeFailed: null,
    restart: null,
    restartFailed: null,
    remove: "absent",
  },
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
  const next = runtimeTransitionMatrix[current][event];
  if (next === null) throw new RuntimeTransitionError(current, event);
  return next;
}

export function reduceRuntimeEvents(
  current: RuntimeStatus,
  events: readonly RuntimeEvent[],
): RuntimeStatus {
  return events.reduce(transitionRuntime, current);
}
