import { describe, expect, it, vi } from "vitest";
import type { AppServerThread, HostRecord } from "~~/shared/types";
import { ThreadLifecycleService } from "./thread-lifecycle";
import { threadSnapshotStore } from "../state/thread-snapshots";
import { threadMetadataStore } from "../state/thread-metadata";
import { gatewayMemoryState } from "../state/memory";
import { threadCatalogEvents, type ThreadCatalogUpdate } from "./thread-catalog-events";

const host: HostRecord = {
  id: 1,
  name: "host",
  sshHost: "127.0.0.1",
  username: "user",
  port: 22,
  authMode: "password",
  privateKeyPath: null,
  proxyUrl: null,
  hasPassword: true,
  createdAt: "",
  updatedAt: "",
};

describe("ThreadLifecycleService", () => {
  it("archives through thread/archive, drops the snapshot, closes the controller, and publishes a catalog event", async () => {
    const request = vi.fn(async () => ({}));
    const close = vi.fn();
    seedSnapshot("thread-1");
    const published: ThreadCatalogUpdate[] = [];
    const unsubscribe = threadCatalogEvents.subscribe(9, (update) => published.push(update));
    const service = new ThreadLifecycleService({
      getHostClient: async () => ({ request }),
      close,
    });

    await service.archive(host, "thread-1", 9);

    expect(request).toHaveBeenCalledWith("thread/archive", { threadId: "thread-1" });
    expect(close).toHaveBeenCalledWith(1, "thread-1");
    expect(threadSnapshotStore.get(1, "thread-1")).toBeNull();
    expect(published).toEqual([
      { hostId: 1, threadId: "thread-1", action: "archived", thread: null },
    ]);
    unsubscribe();
  });

  it("does not delete a thread when archive fails because the rollout is not on disk yet", async () => {
    const request = vi.fn(async () => {
      throw new Error("no rollout found for thread id thread-empty");
    });
    seedSnapshot("thread-empty");
    const service = new ThreadLifecycleService({
      getHostClient: async () => ({ request }),
      close: vi.fn(),
    });

    await expect(service.archive(host, "thread-empty", 9)).rejects.toMatchObject({
      code: "thread_rollout_not_ready",
    });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith("thread/archive", { threadId: "thread-empty" });
    expect(threadSnapshotStore.get(1, "thread-empty")).not.toBeNull();
  });

  it("deletes through thread/delete and removes metadata", async () => {
    const request = vi.fn(async () => ({}));
    const close = vi.fn();
    seedSnapshot("thread-2");
    threadMetadataStore.record(1, 7, appServerThread("thread-2", "Gone"));
    const service = new ThreadLifecycleService({
      getHostClient: async () => ({ request }),
      close,
    });

    await service.delete(host, "thread-2", 9);

    expect(request).toHaveBeenCalledWith("thread/delete", { threadId: "thread-2" });
    expect(threadMetadataStore.get(1, "thread-2")).toBeNull();
    expect(threadSnapshotStore.get(1, "thread-2")).toBeNull();
  });

  it("unarchives through thread/unarchive and returns the restored gateway thread", async () => {
    const restored = appServerThread("thread-3", "Restored");
    const request = vi.fn(async () => ({ thread: restored }));
    threadMetadataStore.record(1, 7, restored);
    const published: ThreadCatalogUpdate[] = [];
    const unsubscribe = threadCatalogEvents.subscribe(9, (update) => published.push(update));
    const service = new ThreadLifecycleService({
      getHostClient: async () => ({ request }),
      close: vi.fn(),
    });

    const thread = await service.unarchive(host, "thread-3", 9);

    expect(request).toHaveBeenCalledWith("thread/unarchive", { threadId: "thread-3" });
    expect(thread).toMatchObject({
      id: "thread-3",
      hostId: 1,
      projectId: 7,
      name: "Restored",
    });
    expect(published).toHaveLength(1);
    const update = published[0];
    if (update === undefined) throw new Error("Expected an unarchive catalog update");
    expect(update).toMatchObject({
      hostId: 1,
      threadId: "thread-3",
      action: "unarchived",
    });
    expect(update.thread).not.toBeNull();
    expect(update.thread?.id).toBe("thread-3");
    expect(update.thread?.projectId).toBe(7);
    unsubscribe();
  });
});

function seedSnapshot(threadId: string) {
  gatewayMemoryState.threadSnapshots = [];
  threadSnapshotStore.set(1, threadId, {
    thread: appServerThread(threadId, threadId),
    history: { thread: { id: threadId, turns: [] } },
    projectId: 7,
    turnsPage: { nextCursor: null, backwardsCursor: null },
    threadSettings: null,
    tokenUsage: null,
  });
}

function appServerThread(id: string, name: string): AppServerThread {
  const now = 1_700_000_000;
  return {
    id,
    extra: null,
    sessionId: id,
    forkedFromId: null,
    parentThreadId: null,
    preview: name,
    ephemeral: false,
    section: null,
    sectionEnteredAt: null,
    projectId: null,
    historyMode: "legacy",
    modelProvider: "test",
    createdAt: now,
    updatedAt: now,
    recencyAt: now,
    status: { type: "idle" },
    path: null,
    cwd: "/tmp/demo",
    cliVersion: "0.151.0",
    source: "appServer",
    canAcceptDirectInput: true,
    threadSource: null,
    agentNickname: null,
    agentRole: null,
    gitInfo: null,
    name,
    turns: [],
  };
}
