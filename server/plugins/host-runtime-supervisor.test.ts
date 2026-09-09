import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  Object.assign(globalThis, {
    defineNitroPlugin: (plugin: unknown) => plugin,
  });
});

const lifecycle = vi.hoisted(() => {
  const calls: string[] = [];
  return {
    calls,
    verifyGatewayDatabase: vi.fn(async () => {
      calls.push("verify database");
    }),
    bootstrapLegacyRuntimeNode: vi.fn(async () => {
      calls.push("bootstrap legacy runtime node");
    }),
    start: vi.fn(() => {
      calls.push("start supervisor");
    }),
    bootstrapStoredUsers: vi.fn(async () => {
      calls.push("bootstrap stored users");
    }),
    startNodeHealthMonitor: vi.fn(() => {
      calls.push("start node health monitor");
    }),
    stopNodeHealthMonitor: vi.fn(() => {
      calls.push("stop node health monitor");
    }),
    startIdleReaper: vi.fn(() => {
      calls.push("start idle runtime reaper");
    }),
    stopIdleReaper: vi.fn(() => {
      calls.push("stop idle runtime reaper");
    }),
    stop: vi.fn(() => {
      calls.push("stop supervisor");
    }),
    closeGatewayDatabase: vi.fn(async () => {
      calls.push("close database");
    }),
  };
});

vi.mock("../utils/gateway/storage/database", () => ({
  verifyGatewayDatabase: lifecycle.verifyGatewayDatabase,
  closeGatewayDatabase: lifecycle.closeGatewayDatabase,
  databaseUnavailableError: (cause: unknown) =>
    Object.assign(new Error("Gateway database is unavailable", { cause }), {
      code: "database_unavailable",
    }),
}));

vi.mock("../utils/gateway/runtime/host-runtime-supervisor", () => ({
  hostRuntimeSupervisor: {
    start: lifecycle.start,
    bootstrapStoredUsers: lifecycle.bootstrapStoredUsers,
    stop: lifecycle.stop,
  },
}));

vi.mock("../utils/gateway/runtime-manager/runtime-node-bootstrap", () => ({
  bootstrapLegacyRuntimeNodeFromEnvironment: lifecycle.bootstrapLegacyRuntimeNode,
}));

vi.mock("../utils/gateway/runtime-manager/runtime-node-health-monitor", () => ({
  runtimeNodeHealthMonitor: {
    start: lifecycle.startNodeHealthMonitor,
    stop: lifecycle.stopNodeHealthMonitor,
  },
}));

vi.mock("../utils/gateway/runtime-manager/runtime-idle-reaper", () => ({
  runtimeIdleReaper: {
    start: lifecycle.startIdleReaper,
    stop: lifecycle.stopIdleReaper,
  },
}));

beforeEach(() => {
  vi.resetModules();
  lifecycle.calls.length = 0;
  vi.clearAllMocks();
});

describe("host runtime supervisor Nitro lifecycle", () => {
  it("keeps plugin module evaluation pending through verification and stored-user bootstrap", async () => {
    let resolveVerification!: () => void;
    lifecycle.verifyGatewayDatabase.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveVerification = () => {
            lifecycle.calls.push("verify database");
            resolve();
          };
        }),
    );

    let evaluated = false;
    const evaluation = import("./host-runtime-supervisor").then((module) => {
      evaluated = true;
      return module;
    });
    await vi.waitFor(() => {
      expect(lifecycle.verifyGatewayDatabase).toHaveBeenCalledOnce();
    });

    expect(evaluated).toBe(false);
    expect(lifecycle.calls).toEqual([]);
    resolveVerification();
    await evaluation;

    expect(lifecycle.calls).toEqual([
      "verify database",
      "bootstrap legacy runtime node",
      "start supervisor",
      "bootstrap stored users",
      "start node health monitor",
      "start idle runtime reaper",
    ]);
    expect(lifecycle.bootstrapStoredUsers).toHaveBeenCalledOnce();
  });

  it("fails module evaluation and closes the pool when database verification fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    lifecycle.verifyGatewayDatabase.mockRejectedValueOnce(new Error("database offline"));

    const rejection = await import("./host-runtime-supervisor").catch((error: unknown) => error);

    expect(rejection).toMatchObject({
      code: "database_unavailable",
      cause: { message: "database offline" },
    });
    expect(lifecycle.calls).toEqual(["close database"]);
  });

  it("stops the started supervisor and closes the pool when stored-user bootstrap fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    lifecycle.bootstrapStoredUsers.mockImplementationOnce(async () => {
      lifecycle.calls.push("bootstrap stored users");
      throw new Error("stored config is invalid");
    });

    const rejection = await import("./host-runtime-supervisor").catch((error: unknown) => error);

    expect(rejection).toMatchObject({ message: "stored config is invalid" });
    expect(lifecycle.calls).toEqual([
      "verify database",
      "bootstrap legacy runtime node",
      "start supervisor",
      "bootstrap stored users",
      "stop supervisor",
      "close database",
    ]);
  });

  it("closes the pool without starting background work when legacy node bootstrap fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    lifecycle.bootstrapLegacyRuntimeNode.mockImplementationOnce(async () => {
      lifecycle.calls.push("bootstrap legacy runtime node");
      throw Object.assign(new Error("legacy node bootstrap failed"), {
        code: "runtime_node_bootstrap_failed",
      });
    });

    const rejection = await import("./host-runtime-supervisor").catch((error: unknown) => error);

    expect(rejection).toMatchObject({ code: "runtime_node_bootstrap_failed" });
    expect(lifecycle.calls).toEqual([
      "verify database",
      "bootstrap legacy runtime node",
      "close database",
    ]);
  });

  it("registers shutdown that stops runtime resources before closing the MySQL pool", async () => {
    const pluginModule = await import("./host-runtime-supervisor");
    const fakeNitroApp = nitroApp();
    Reflect.apply(pluginModule.default, undefined, [fakeNitroApp.app]);

    await fakeNitroApp.close();

    expect(lifecycle.calls).toEqual([
      "verify database",
      "bootstrap legacy runtime node",
      "start supervisor",
      "bootstrap stored users",
      "start node health monitor",
      "start idle runtime reaper",
      "stop idle runtime reaper",
      "stop node health monitor",
      "stop supervisor",
      "close database",
    ]);
  });
});

function nitroApp() {
  let closeHook: (() => void | Promise<void>) | undefined;
  const app = {
    hooks: {
      hook(name: string, callback: () => void | Promise<void>) {
        expect(name).toBe("close");
        closeHook = callback;
      },
    },
  };
  return {
    app,
    async close() {
      expect(closeHook).toBeDefined();
      await closeHook?.();
    },
  };
}
