import { describe, expect, it, vi } from "vitest";
import { DATAOPS_INTEGRATION_REDIS_CHANNEL, createDataOpsIntegrationInvalidation } from "./dataops-invalidation";

describe("DataOps integration invalidation", () => {
  it("subscribes to the exact secret-free channel payload", async () => {
    const on = vi.fn();
    const subscribe = vi.fn().mockResolvedValue(undefined);
    const provider = { invalidate: vi.fn() };
    const invalidation = createDataOpsIntegrationInvalidation({ provider, subscriber: { on, subscribe, quit: vi.fn() } });

    await invalidation.start();
    expect(subscribe).toHaveBeenCalledWith(DATAOPS_INTEGRATION_REDIS_CHANNEL);
    const handler = on.mock.calls.find(([event]) => event === "message")?.[1];
    handler(DATAOPS_INTEGRATION_REDIS_CHANNEL, JSON.stringify({ revision: 7, pairingId: "pairing-fixed" }));
    expect(provider.invalidate).toHaveBeenCalledWith(7);
  });

  it("keeps MySQL correctness available when Redis startup fails", async () => {
    const provider = { invalidate: vi.fn() };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const invalidation = createDataOpsIntegrationInvalidation({ provider, subscriber: { on: vi.fn(), subscribe: vi.fn().mockRejectedValue(new Error("redis unavailable")), quit: vi.fn() } });

    await expect(invalidation.start()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
