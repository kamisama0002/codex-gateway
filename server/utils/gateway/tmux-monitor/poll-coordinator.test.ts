import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultGatewayConfig } from "../../../../shared/config";
import { userStore } from "../auth/users";
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
});
