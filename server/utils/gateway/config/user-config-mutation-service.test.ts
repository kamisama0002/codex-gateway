import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultGatewayConfig } from "../../../../shared/config";
import type { AppServerThread } from "../../../../shared/types";
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

  it("preserves transient runtime state changed while config persistence is pending", async () => {
    let resolveSave!: (revision: number) => void;
    vi.spyOn(userStore, "saveConfig").mockReturnValue(
      new Promise<number>((resolve) => {
        resolveSave = resolve;
      }),
    );
    const service = new UserConfigMutationService();

    await runWithGatewayUser(504, async () => {
      installLoadedState(12);
      const committing = service.commit(504, () => {
        currentGatewayMemoryState().notifications.bark.group = "persisted config";
      });
      await vi.waitFor(() => expect(userStore.saveConfig).toHaveBeenCalledOnce());

      const liveState = currentGatewayMemoryState();
      installTransientState(liveState);
      resolveSave(13);
      await committing;

      expect(currentGatewayMemoryState()).toBe(liveState);
      expect(currentGatewayMemoryState()).toMatchObject({
        configRevision: 13,
        nextEventId: 90_002,
        pendingNotificationKeys: ["notification-during-save"],
      });
      expect(currentGatewayMemoryState().notifications.bark.group).toBe("persisted config");
      expect(currentGatewayMemoryState().events.map((event) => event.id)).toEqual([90_001]);
      expect(currentGatewayMemoryState().threadSnapshots.map((entry) => entry.threadId)).toEqual([
        "thread-during-save",
      ]);
    });
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

function installTransientState(state: ReturnType<typeof currentGatewayMemoryState>) {
  state.events.push({
    id: 90_001,
    hostId: 1,
    threadId: "thread-during-save",
    method: "thread/status/changed",
    payload: { method: "thread/status/changed", params: { status: "running" } },
    createdAt: "2026-09-05T01:00:00.000Z",
  });
  state.nextEventId = 90_002;
  state.pendingNotificationKeys.push("notification-during-save");
  state.threadSnapshots.push({
    hostId: 1,
    threadId: "thread-during-save",
    snapshot: {
      thread: appServerThread("thread-during-save"),
      history: { thread: { id: "thread-during-save", turns: [] } },
      projectId: 2,
      turnsPage: { nextCursor: null, backwardsCursor: null },
      threadSettings: null,
      tokenUsage: null,
    },
    updatedAt: "2026-09-05T01:00:00.000Z",
  });
}

function appServerThread(id: string): AppServerThread {
  return {
    id,
    extra: null,
    sessionId: id,
    forkedFromId: null,
    parentThreadId: null,
    preview: id,
    ephemeral: false,
    section: null,
    sectionEnteredAt: null,
    projectId: null,
    historyMode: "legacy",
    modelProvider: "test",
    createdAt: 1_700_000_000,
    updatedAt: 1_700_000_000,
    recencyAt: 1_700_000_000,
    status: { type: "idle" },
    path: null,
    cwd: "/tmp/project",
    cliVersion: "0.151.0",
    source: "appServer",
    canAcceptDirectInput: true,
    threadSource: null,
    agentNickname: null,
    agentRole: null,
    gitInfo: null,
    name: id,
    turns: [],
  };
}
