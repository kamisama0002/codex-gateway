import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  Object.assign(globalThis, { defineNitroPlugin: (plugin: unknown) => plugin });
});

import { createDataOpsIntegrationRefreshLifecycle } from "./dataops-integration-refresh";

describe("DataOps integration Redis lifecycle", () => {
  it("closes publisher and subscriber exactly once even when one close fails", async () => {
    const subscriber = {
      on: vi.fn(),
      subscribe: vi.fn().mockResolvedValue(undefined),
      quit: vi.fn().mockRejectedValue(new Error("subscriber close failed")),
    };
    const publisher = { publish: vi.fn(), quit: vi.fn().mockResolvedValue(undefined) };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const lifecycle = createDataOpsIntegrationRefreshLifecycle({
      provider: { invalidate: vi.fn() },
      subscriber,
      publisher,
      configurePublisher: vi.fn(),
    });

    await lifecycle.start();
    await lifecycle.stop();

    expect(subscriber.quit).toHaveBeenCalledOnce();
    expect(publisher.quit).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
