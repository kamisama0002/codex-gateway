import { afterEach, describe, expect, it, vi } from "vitest";
import { userStore } from "../auth/users";
import { hostRuntimeSupervisor } from "./host-runtime-supervisor";

afterEach(() => {
  hostRuntimeSupervisor.stop();
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
});
