import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HostRecord } from "~~/shared/types";
import { userStore } from "../auth/users";
import { currentGatewayUserId } from "../state/memory";
import { activeMainThreadMonitor } from "./active-main-thread-monitor";
import { threadBroker } from "./broker";
import { hostRuntimeSupervisor } from "./host-runtime-supervisor";

const runtimeConnection = vi.hoisted(() => ({
  connect: vi.fn(async () => {}),
}));

vi.mock("./host-runtime-connection", () => ({
  connectHostRuntime: runtimeConnection.connect,
  publishHostRuntimeFailure: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  hostRuntimeSupervisor.stop();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("HostRuntimeSupervisor", () => {
  it("awaits the stored-config query before completing bootstrap", async () => {
    let resolveConfigs!: (configs: []) => void;
    const configs = new Promise<[]>((resolve) => {
      resolveConfigs = resolve;
    });
    const listStoredConfigs = vi.spyOn(userStore, "listStoredConfigs").mockReturnValue(configs);
    hostRuntimeSupervisor.start();

    const bootstrap = hostRuntimeSupervisor.bootstrapStoredUsers();
    expect(bootstrap).toBeInstanceOf(Promise);
    expect(listStoredConfigs).toHaveBeenCalledOnce();
    resolveConfigs([]);

    await expect(bootstrap).resolves.toBeUndefined();
  });

  it("does not connect stored hosts until their configs finish loading", async () => {
    vi.useFakeTimers();
    let resolveConfigs!: (configs: ReturnType<typeof storedConfig>[]) => void;
    const configs = new Promise<ReturnType<typeof storedConfig>[]>((resolve) => {
      resolveConfigs = resolve;
    });
    vi.spyOn(userStore, "listStoredConfigs").mockReturnValue(configs);
    hostRuntimeSupervisor.start();

    const bootstrap = hostRuntimeSupervisor.bootstrapStoredUsers();
    await vi.runAllTimersAsync();
    expect(runtimeConnection.connect).not.toHaveBeenCalled();

    resolveConfigs([storedConfig()]);
    await bootstrap;
    await vi.runAllTimersAsync();

    expect(runtimeConnection.connect).toHaveBeenCalledOnce();
  });

  it("loads stored configs only once when bootstrap is requested concurrently", async () => {
    const listStoredConfigs = vi.spyOn(userStore, "listStoredConfigs").mockResolvedValue([]);
    hostRuntimeSupervisor.start();

    await Promise.all([
      hostRuntimeSupervisor.bootstrapStoredUsers(),
      hostRuntimeSupervisor.bootstrapStoredUsers(),
    ]);

    expect(listStoredConfigs).toHaveBeenCalledOnce();
  });

  it("closes a settled host session under its user scope when stopped", async () => {
    vi.useFakeTimers();
    const closedHosts: Array<{ userId: number | null; hostId: number }> = [];
    vi.spyOn(threadBroker, "closeHost").mockImplementation((hostId) => {
      closedHosts.push({ userId: currentGatewayUserId(), hostId });
    });
    const forgetHost = vi.spyOn(activeMainThreadMonitor, "forgetHost").mockImplementation(() => {});
    vi.spyOn(userStore, "listStoredConfigs").mockResolvedValue([storedConfig()]);
    hostRuntimeSupervisor.start();
    await hostRuntimeSupervisor.bootstrapStoredUsers();
    await vi.runAllTimersAsync();
    expect(runtimeConnection.connect).toHaveBeenCalledOnce();

    hostRuntimeSupervisor.stop();

    expect(closedHosts).toEqual([{ userId: 7, hostId: 11 }]);
    expect(forgetHost).toHaveBeenCalledOnce();
    expect(forgetHost).toHaveBeenCalledWith(7, 11);
  });

  it("closes an in-flight host immediately and again after a late connection settles", async () => {
    vi.useFakeTimers();
    let resolveConnection!: () => void;
    runtimeConnection.connect.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveConnection = resolve;
      }),
    );
    const closedHosts: Array<{ userId: number | null; hostId: number }> = [];
    let resolveLateClose!: () => void;
    const lateClose = new Promise<void>((resolve) => {
      resolveLateClose = resolve;
    });
    vi.spyOn(threadBroker, "closeHost").mockImplementation((hostId) => {
      closedHosts.push({ userId: currentGatewayUserId(), hostId });
      if (closedHosts.length === 2) resolveLateClose();
    });
    vi.spyOn(userStore, "listStoredConfigs").mockResolvedValue([storedConfig()]);
    hostRuntimeSupervisor.start();
    await hostRuntimeSupervisor.bootstrapStoredUsers();
    await vi.runAllTimersAsync();
    expect(runtimeConnection.connect).toHaveBeenCalledOnce();

    hostRuntimeSupervisor.stop();
    const closedBeforeConnectionSettled = [...closedHosts];
    resolveConnection();

    expect(closedBeforeConnectionSettled).toEqual([{ userId: 7, hostId: 11 }]);
    await lateClose;
    expect(closedHosts).toEqual([
      { userId: 7, hostId: 11 },
      { userId: 7, hostId: 11 },
    ]);
  });
});

function storedConfig() {
  return {
    user: { id: 7, username: "stored-user", role: "user" as const },
    config: {
      version: 1 as const,
      hosts: [host()],
      projects: [],
      pinnedThreads: [],
      notifications: { bark: { enabled: false, serverUrl: "", deviceKey: "", group: "" } },
      pet: { enabled: true, petId: "congming" as const, animations: true },
    },
    revision: 4,
  };
}

function host(): HostRecord {
  return {
    id: 11,
    name: "stored-host",
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
  };
}
