import { afterEach, describe, expect, it, vi } from "vitest";
import type { HostRecord } from "../../../../shared/types";
import { hostMetricsManager } from "../infra/host-services";
import { runWithGatewayUser } from "../state/memory";
import { tmuxMonitorService } from "../tmux-monitor/monitor-service";
import { hostResourceLifecycle } from "./host-resource-lifecycle";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("hostResourceLifecycle", () => {
  it("still removes host metrics when deleted-host monitor cleanup rejects", async () => {
    const failure = new Error("monitor deletion failed");
    vi.spyOn(tmuxMonitorService, "removeHost").mockRejectedValue(failure);
    const removeMetrics = vi.spyOn(hostMetricsManager, "removeHost").mockImplementation(() => {});

    await expect(runWithGatewayUser(81, () => hostResourceLifecycle.deleted(81, 10))).rejects.toBe(
      failure,
    );

    expect(removeMetrics).toHaveBeenCalledWith(81, 10);
  });

  it("still removes host metrics when changed-host monitor cleanup rejects", async () => {
    const failure = new Error("monitor deletion failed");
    vi.spyOn(tmuxMonitorService, "removeHost").mockRejectedValue(failure);
    const removeMetrics = vi.spyOn(hostMetricsManager, "removeHost").mockImplementation(() => {});

    await expect(
      runWithGatewayUser(82, () =>
        hostResourceLifecycle.changed(82, host(), host({ sshHost: "replacement.internal" })),
      ),
    ).rejects.toBe(failure);

    expect(removeMetrics).toHaveBeenCalledWith(82, 10);
  });
});

function host(overrides: Partial<HostRecord> = {}): HostRecord {
  return {
    id: 10,
    name: "training-host",
    sshHost: "host.internal",
    username: "codex",
    port: 22,
    authMode: "password",
    privateKeyPath: null,
    password: "secret",
    proxyUrl: null,
    hasPassword: true,
    createdAt: "2026-09-05T00:00:00.000Z",
    updatedAt: "2026-09-05T00:00:00.000Z",
    ...overrides,
  };
}
