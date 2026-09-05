import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { GatewayThread, HostRecord, ProjectRecord } from "~~/shared/types";
import { useGatewayBootstrapStore } from "@/stores/gateway-bootstrap";
import { useGatewayCatalogStore } from "@/stores/gateway-catalog";
import { useGatewayNavigationStore } from "@/stores/gateway-navigation";
import { useGatewayThreadRuntimeStore } from "@/stores/gateway-thread-runtime";
import { useGatewayThreadViewStore } from "@/stores/gateway-thread-view";

vi.mock("@codex-gateway/ui/sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));
vi.mock("@/stores/auth", () => ({
  useAuthStore: () => ({
    token: "",
    username: "",
    sessionEpoch: 0,
    hydrate: vi.fn(),
    isCurrentSession: () => true,
  }),
}));

const hostId = 7;
const projectId = 11;
const threadId = "new-thread";

describe("thread list refresh modes", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.stubGlobal("useNuxtApp", () => ({
      $i18n: { t: (key: string) => key },
    }));
  });

  it("keeps active conversation state while a delayed passive catalog refresh succeeds", async () => {
    const request = deferred<ReturnType<typeof threadListResponse>>();
    vi.stubGlobal(
      "$fetch",
      vi.fn(() => request.promise),
    );
    const { bootstrap, catalog, navigation, runtime, views } = seedSelectedThread();
    const existingError = bootstrap.error;

    const refresh = navigation.listThreads("", { mode: "passive" });

    expect(views.loading).toBe(false);
    expect(bootstrap.error).toBe(existingError);

    request.resolve(threadListResponse());
    await refresh;

    expect(views.loading).toBe(false);
    expect(bootstrap.error).toBe(existingError);
    expect(runtime.statusFor(hostId, threadId)).toBe("running");
    expect(runtime.phaseFor(hostId, threadId)).toBe("submitting");
    expect(navigation.threads.map((thread) => thread.id)).toEqual([threadId]);
    expect(navigation.hostThreads.map((thread) => thread.id)).toEqual([threadId]);
    expect(catalog.projects.find((project) => project.id === projectId)?.name).toBe(
      "Refreshed project",
    );
  });

  it("keeps active conversation and host state when a passive catalog refresh fails", async () => {
    const request = deferred<never>();
    vi.stubGlobal(
      "$fetch",
      vi.fn(() => request.promise),
    );
    const { bootstrap, catalog, navigation, runtime, views } = seedSelectedThread();
    runtime.setThreadStatus(hostId, threadId, "running", { phase: "running" });
    const existingError = bootstrap.error;
    const existingHostState = catalog.hostConnectionStatuses[hostId];

    const refresh = navigation.listThreads("", { mode: "passive" });
    request.reject(new Error("catalog unavailable"));
    await refresh;

    expect(views.loading).toBe(false);
    expect(bootstrap.error).toBe(existingError);
    expect(catalog.hostConnectionStatuses[hostId]).toBe(existingHostState);
    expect(runtime.statusFor(hostId, threadId)).toBe("running");
    expect(runtime.phaseFor(hostId, threadId)).toBe("running");
  });

  it("does not clear a failed host state when a passive catalog refresh succeeds", async () => {
    vi.stubGlobal(
      "$fetch",
      vi.fn(() => Promise.resolve(threadListResponse())),
    );
    const { catalog, navigation } = seedSelectedThread();
    catalog.setHostConnectionStatus(hostId, "failed", "keep host failure");
    const existingHostState = catalog.hostConnectionStatuses[hostId];

    await navigation.listThreads("", { mode: "passive" });

    expect(catalog.hostConnectionStatuses[hostId]).toBe(existingHostState);
  });

  it.each([
    "submitting",
    "retrying",
    "waitingForApproval",
    "waitingForInput",
    "waitingForClient",
  ] as const)("keeps the realtime %s phase when a passive snapshot is active", async (phase) => {
    vi.stubGlobal(
      "$fetch",
      vi.fn(() => Promise.resolve(threadListResponse({ type: "active", activeFlags: [] }))),
    );
    const { navigation, runtime } = seedSelectedThread();
    runtime.setThreadStatus(hostId, threadId, "running", { phase });

    await navigation.listThreads("", { mode: "passive" });

    expect(runtime.statusFor(hostId, threadId)).toBe("running");
    expect(runtime.phaseFor(hostId, threadId)).toBe(phase);
  });

  it("retains foreground loading, error, host, and snapshot behavior", async () => {
    const request = deferred<ReturnType<typeof threadListResponse>>();
    vi.stubGlobal(
      "$fetch",
      vi.fn(() => request.promise),
    );
    const { bootstrap, catalog, navigation, runtime, views } = seedSelectedThread();

    const refresh = navigation.listThreads();

    expect(views.loading).toBe(true);
    expect(bootstrap.error).toBeNull();

    request.resolve(threadListResponse());
    await refresh;

    expect(views.loading).toBe(false);
    expect(catalog.hostConnectionStatuses[hostId]?.status).toBe("connected");
    expect(runtime.statusFor(hostId, threadId)).toBe("completed");
    expect(runtime.phaseFor(hostId, threadId)).toBe("completed");
  });
});

function seedSelectedThread() {
  const bootstrap = useGatewayBootstrapStore();
  const catalog = useGatewayCatalogStore();
  const navigation = useGatewayNavigationStore();
  const runtime = useGatewayThreadRuntimeStore();
  const views = useGatewayThreadViewStore();
  catalog.hosts = [hostRecord()];
  catalog.projects = [projectRecord("Initial project")];
  catalog.setHostConnectionStatus(hostId, "connected");
  navigation.selectedHostId = hostId;
  navigation.selectedProjectId = projectId;
  navigation.selectedThreadId = threadId;
  runtime.setThreadStatus(hostId, threadId, "running", { phase: "submitting" });
  bootstrap.setError("keep current conversation error", { hostId, projectId, threadId });
  return { bootstrap, catalog, navigation, runtime, views };
}

function threadListResponse(status: GatewayThread["status"] = { type: "idle" }) {
  return {
    data: [gatewayThread(status)],
    projects: [projectRecord("Refreshed project")],
  };
}

function gatewayThread(status: GatewayThread["status"]): GatewayThread {
  return {
    id: threadId,
    extra: null,
    sessionId: "session-1",
    forkedFromId: null,
    parentThreadId: null,
    preview: "new thread",
    ephemeral: false,
    section: null,
    sectionEnteredAt: null,
    appServerProjectId: null,
    historyMode: "paginated",
    modelProvider: "openai",
    createdAt: 1,
    updatedAt: 2,
    recencyAt: 2,
    status,
    path: null,
    cwd: "/workspace/project",
    cliVersion: "0.151.0",
    source: "appServer",
    canAcceptDirectInput: true,
    threadSource: null,
    agentNickname: null,
    agentRole: null,
    gitInfo: null,
    name: "new thread",
    turns: [],
    hostId,
    projectId,
    pinned: false,
    title: "New thread",
  };
}

function hostRecord(): HostRecord {
  return {
    id: hostId,
    connectionKind: "ssh",
    name: "Test host",
    sshHost: "example.test",
    username: "tester",
    port: 22,
    authMode: "agent",
    privateKeyPath: null,
    proxyUrl: null,
    hasPassword: false,
    createdAt: "2026-09-05T00:00:00.000Z",
    updatedAt: "2026-09-05T00:00:00.000Z",
  };
}

function projectRecord(name: string): ProjectRecord {
  return {
    id: projectId,
    hostId,
    name,
    remotePath: "/workspace/project",
    createdAt: "2026-09-05T00:00:00.000Z",
    updatedAt: "2026-09-05T00:00:00.000Z",
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
