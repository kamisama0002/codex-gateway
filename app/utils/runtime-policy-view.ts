import type { ManagedRuntimeStatusView } from "@codex-gateway/agent-runtime-contracts";

export type RuntimePolicyView = Pick<
  ManagedRuntimeStatusView,
  "assignedPolicy" | "actualResources" | "currentImageAlias" | "requiresRestart" | "requiresUpgrade"
>;

export type RuntimePolicyBadge = "restart" | "upgrade";

interface ResourceSummary {
  imageAlias: string | null;
  memory: string;
  cpu: string;
  pids: string;
}

export interface RuntimePolicySummary {
  assigned: ResourceSummary | null;
  actual: ResourceSummary | null;
  badges: RuntimePolicyBadge[];
}

export function formatMemoryMiB(memoryMiB: number) {
  if (memoryMiB % 1024 === 0) return `${memoryMiB / 1024} GiB`;
  return `${memoryMiB} MiB`;
}

export function formatCpuCores(cpuMillicores: number) {
  return `${cpuMillicores / 1000} CPU`;
}

export function formatPidsLimit(pidsLimit: number) {
  return String(pidsLimit);
}

export function policyBadges(
  view: Pick<RuntimePolicyView, "requiresRestart" | "requiresUpgrade">,
): RuntimePolicyBadge[] {
  return [
    ...(view.requiresRestart ? (["restart"] as const) : []),
    ...(view.requiresUpgrade ? (["upgrade"] as const) : []),
  ];
}

export function runtimePolicySummary(view: RuntimePolicyView): RuntimePolicySummary {
  return {
    assigned:
      view.assignedPolicy === null
        ? null
        : {
            imageAlias: view.assignedPolicy.imageAlias,
            memory: formatMemoryMiB(view.assignedPolicy.memoryMiB),
            cpu: formatCpuCores(view.assignedPolicy.cpuCores * 1000),
            pids: formatPidsLimit(view.assignedPolicy.pidsLimit),
          },
    actual:
      view.actualResources === null
        ? null
        : {
            imageAlias: view.currentImageAlias,
            memory: formatMemoryMiB(view.actualResources.memoryBytes / (1024 * 1024)),
            cpu: formatCpuCores(view.actualResources.nanoCpus / 1_000_000),
            pids: formatPidsLimit(view.actualResources.pidsLimit),
          },
    badges: policyBadges(view),
  };
}
