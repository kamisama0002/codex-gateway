import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultGatewayConfig } from "../../../../shared/config";
import { MANAGED_RUNTIME_HOST_ID } from "../../../../shared/runtime/managed-runtime";
import { userStore } from "../auth/users";
import { sshConnections } from "../infra/host-services";
import { hostRuntimeSupervisor } from "../runtime/host-runtime-supervisor";
import {
  buildGatewayMemoryState,
  currentGatewayMemoryState,
  replaceCurrentGatewayMemoryState,
  runWithGatewayUser,
} from "../state/memory";
import { ConfigRevisionConflictError } from "./user-config-repository";
import { UserConfigMutationService } from "./user-config-mutation-service";
import { pinnedThreadEvents } from "./pinned-thread-events";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("UserConfigMutationService", () => {
  it("restores memory and publishes no runtime side effects when persistence fails", async () => {
    const save = vi
      .spyOn(userStore, "saveConfig")
      .mockRejectedValue(new Error("configuration encryption failed"));
    const syncHosts = vi.spyOn(sshConnections, "syncHosts");
    const syncSupervisor = vi.spyOn(hostRuntimeSupervisor, "syncCurrentUserConfig");
    const publishPinned = vi.spyOn(pinnedThreadEvents, "publish");
    const service = new UserConfigMutationService();

    await runWithGatewayUser(501, async () => {
      installLoadedState(7);
      const previous = currentGatewayMemoryState();

      await expect(
        service.commit(501, () => {
          currentGatewayMemoryState().hosts = [hostRecord()];
          currentGatewayMemoryState().pinnedThreads = [pinnedThread()];
          return "draft-result";
        }),
      ).rejects.toThrow("configuration encryption failed");

      expect(currentGatewayMemoryState()).toBe(previous);
      expect(currentGatewayMemoryState()).toMatchObject({
        hosts: [],
        pinnedThreads: [],
        configRevision: 7,
      });
    });
    expect(save).toHaveBeenCalledWith(501, expect.any(Object), 7);
    expect(syncHosts).not.toHaveBeenCalled();
    expect(syncSupervisor).not.toHaveBeenCalled();
    expect(publishPinned).not.toHaveBeenCalled();
  });

  it("keeps the winning revision in memory after a stale-write conflict", async () => {
    vi.spyOn(userStore, "saveConfig").mockRejectedValue(new ConfigRevisionConflictError("stale"));
    const service = new UserConfigMutationService();

    await runWithGatewayUser(502, async () => {
      installLoadedState(11);
      await expect(
        service.commit(502, () => {
          currentGatewayMemoryState().notifications.bark.group = "losing draft";
        }),
      ).rejects.toMatchObject({ code: "config_revision_conflict" });

      expect(currentGatewayMemoryState().configRevision).toBe(11);
      expect(currentGatewayMemoryState().notifications.bark.group).toBe("Codex Gateway");
    });
  });

  it("installs the committed revision before publishing reconciliation side effects", async () => {
    const observations: string[] = [];
    vi.spyOn(userStore, "saveConfig").mockImplementation(async (_userId, _config, revision) => {
      observations.push(`save:${revision}:${currentGatewayMemoryState().configRevision}`);
      return revision + 1;
    });
    vi.spyOn(pinnedThreadEvents, "publish").mockImplementation(() => {
      observations.push(`publish:${currentGatewayMemoryState().configRevision}`);
    });
    const service = new UserConfigMutationService();

    await runWithGatewayUser(503, async () => {
      installLoadedState(4);
      await expect(
        service.commit(503, () => {
          currentGatewayMemoryState().pinnedThreads = [pinnedThread()];
          return "committed";
        }),
      ).resolves.toBe("committed");
      expect(currentGatewayMemoryState().configRevision).toBe(5);
    });
    expect(observations).toEqual(["save:4:4", "publish:5"]);
  });
});

function installLoadedState(revision: number) {
  const state = buildGatewayMemoryState(defaultGatewayConfig());
  state.configLoaded = true;
  state.configRevision = revision;
  replaceCurrentGatewayMemoryState(state);
}

function pinnedThread() {
  return {
    hostId: MANAGED_RUNTIME_HOST_ID,
    projectId: null,
    threadId: "thread-1",
    title: "Pinned",
    subtitle: null,
    projectName: null,
    updatedAt: null,
  };
}

function hostRecord() {
  return {
    id: 1,
    name: "host",
    sshHost: "host.internal",
    username: "codex",
    port: 22,
    authMode: "password" as const,
    privateKeyPath: null,
    password: "secret",
    proxyUrl: null,
    hasPassword: true,
    createdAt: "2026-09-05T00:00:00.000Z",
    updatedAt: "2026-09-05T00:00:00.000Z",
  };
}
