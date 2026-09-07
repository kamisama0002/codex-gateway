import { describe, expect, it } from "vitest";
import {
  formatCpuCores,
  formatMemoryMiB,
  formatPidsLimit,
  policyBadges,
  runtimePolicySummary,
  shouldShowRuntimePolicy,
  type RuntimePolicyView,
} from "./runtime-policy-view";

describe("runtime policy presentation", () => {
  it("formats assigned memory, CPU, and PID limits", () => {
    expect(formatMemoryMiB(2048)).toBe("2 GiB");
    expect(formatCpuCores(1500)).toBe("1.5 CPU");
    expect(formatPidsLimit(256)).toBe("256");
  });

  it("formats assigned and inspected resources from the public runtime view", () => {
    expect(
      runtimePolicySummary({
        assignedPolicy: {
          imageAlias: "tenant-stable",
          memoryMiB: 2048,
          cpuCores: 1.5,
          pidsLimit: 256,
        },
        actualResources: {
          memoryBytes: 1024 * 1024 * 1024,
          nanoCpus: 1_000_000_000,
          pidsLimit: 128,
        },
        currentImageAlias: "tenant-current",
        requiresRestart: false,
        requiresUpgrade: false,
      }),
    ).toEqual({
      assigned: {
        imageAlias: "tenant-stable",
        memory: "2 GiB",
        cpu: "1.5 CPU",
        pids: "256",
      },
      actual: {
        imageAlias: "tenant-current",
        memory: "1 GiB",
        cpu: "1 CPU",
        pids: "128",
      },
      badges: [],
    });
  });

  it("shows restart and upgrade drift badges", () => {
    expect(policyBadges({ requiresRestart: true, requiresUpgrade: true })).toEqual([
      "restart",
      "upgrade",
    ]);
  });

  it("shows assigned policy before the runtime has started", () => {
    expect(
      shouldShowRuntimePolicy({
        runtime: null,
        assignedPolicy: {
          imageAlias: "tenant-stable",
          memoryMiB: 2048,
          cpuCores: 1.5,
          pidsLimit: 256,
        },
        actualResources: null,
      }),
    ).toBe(true);
  });

  it("does not include internal runtime details in the presentation", () => {
    const view: RuntimePolicyView & {
      tenantId: number;
      runtimeId: string;
      containerId: string;
      serviceToken: string;
      node: string;
      network: string;
      imageReference: string;
    } = {
      assignedPolicy: null,
      actualResources: null,
      currentImageAlias: null,
      requiresRestart: false,
      requiresUpgrade: false,
      tenantId: 1,
      runtimeId: "runtime-private",
      containerId: "container-private",
      serviceToken: "token-private",
      node: "node-private",
      network: "network-private",
      imageReference: "registry.example/private",
    };

    expect(JSON.stringify(runtimePolicySummary(view))).not.toMatch(
      /tenant|runtime-private|container|token|node|network|registry/i,
    );
  });
});
