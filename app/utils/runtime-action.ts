import type { RuntimeStatus } from "@codex-gateway/agent-runtime-contracts";

export type RuntimeAction = "start" | "restart" | "pending";

const pendingRuntimeStatuses: ReadonlySet<RuntimeStatus> = new Set([
  "provisioning",
  "starting",
  "schema_checking",
  "syncing_capabilities",
  "restarting",
]);

export function runtimeActionForStatus(status: RuntimeStatus | null | undefined): RuntimeAction {
  if (status === "ready") return "restart";
  if (status !== null && status !== undefined && pendingRuntimeStatuses.has(status)) {
    return "pending";
  }
  return "start";
}

export function isRuntimeActionPending(status: RuntimeStatus | null | undefined): boolean {
  return runtimeActionForStatus(status) === "pending";
}
