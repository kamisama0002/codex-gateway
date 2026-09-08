import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultGatewayConfig } from "../../../../shared/config";
import { MANAGED_RUNTIME_HOST_ID } from "../../../../shared/runtime/managed-runtime";
import { userStore } from "../auth/users";
import { runtimeService } from "../runtime-manager/runtime-service";
import { tmuxMonitorService } from "./monitor-service";
import { TmuxMonitorPollCoordinator } from "./poll-coordinator";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("TmuxMonitorPollCoordinator", () => {
  it("awaits monitor discovery and missing-host deletion before completing", async () => {
    let resolveGroups!: (groups: Awaited<ReturnType<typeof tmuxMonitorService.pollGroups>>) => void;
    const groups = new Promise<Awaited<ReturnType<typeof tmuxMonitorService.pollGroups>>>(
      (resolve) => {
        resolveGroups = resolve;
      },
    );
    vi.spyOn(tmuxMonitorService, "pollGroups").mockReturnValue(groups);
    const loadConfig = vi.spyOn(userStore, "loadConfig").mockResolvedValue({
      config: defaultGatewayConfig(),
      revision: 1,
    });
    let resolveRemoval!: () => void;
    const removal = new Promise<void>((resolve) => {
      resolveRemoval = resolve;
    });
    const removeHost = vi.spyOn(tmuxMonitorService, "removeHost").mockReturnValue(removal);
    const coordinator = new TmuxMonitorPollCoordinator();

    let completed = false;
    const run = coordinator.run().then((result) => {
      completed = true;
      return result;
    });
    void run.catch(() => {});
    await Promise.resolve();
    expect(loadConfig).not.toHaveBeenCalled();

    resolveGroups([{ userId: 1, hostId: 10, monitors: [], pendingNotifications: [] }]);
    await vi.waitFor(() => expect(removeHost).toHaveBeenCalledWith(1, 10));
    expect(completed).toBe(false);

    resolveRemoval();
    await expect(run).resolves.toEqual({ skipped: false, checkedHosts: 1 });
  });

  it("resolves managed Agent monitors without looking for a configured SSH host", async () => {
    vi.spyOn(tmuxMonitorService, "pollGroups").mockResolvedValue([
      {
        userId: 7,
        hostId: MANAGED_RUNTIME_HOST_ID,
        monitors: [],
        pendingNotifications: [],
      },
    ]);
    const host = {
      id: MANAGED_RUNTIME_HOST_ID,
      connectionKind: "managed" as const,
      name: "Local",
      sshHost: "localhost",
      username: null,
      port: null,
      authMode: "agent" as const,
      privateKeyPath: null,
      privateKey: null,
      password: null,
      proxyUrl: null,
      hasPassword: false,
      createdAt: "2026-09-08T00:00:00.000Z",
      updatedAt: "2026-09-08T00:00:00.000Z",
    };
    const resolveManagedHost = vi
      .spyOn(runtimeService, "resolveManagedHost")
      .mockResolvedValue(host);
    const loadConfig = vi.spyOn(userStore, "loadConfig").mockResolvedValue({
      config: defaultGatewayConfig(),
      revision: 1,
    });

    await expect(new TmuxMonitorPollCoordinator().run()).resolves.toEqual({
      skipped: false,
      checkedHosts: 1,
    });

    expect(resolveManagedHost).toHaveBeenCalledWith(7);
    expect(loadConfig).not.toHaveBeenCalled();
  });
});
