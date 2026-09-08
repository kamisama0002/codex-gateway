import { describe, expect, it, vi } from "vitest";
import {
  DATAOPS_INTEGRATION_REDIS_CHANNEL,
  createDataOpsIntegrationInvalidation,
} from "./dataops-invalidation";

type MessageListener = (channel: string, payload: string) => void;

describe("DataOps integration invalidation", () => {
  it("subscribes to the exact secret-free channel payload", async () => {
    const listeners = new Map<"message", MessageListener>();
    const on = vi.fn((event: "message", listener: MessageListener) => {
      listeners.set(event, listener);
    });
    const subscribe = vi.fn().mockResolvedValue(undefined);
    const provider = { invalidate: vi.fn() };
    const invalidation = createDataOpsIntegrationInvalidation({
      provider,
      subscriber: { on, subscribe, quit: vi.fn() },
    });

    await invalidation.start();
    expect(subscribe).toHaveBeenCalledWith(DATAOPS_INTEGRATION_REDIS_CHANNEL);
    const messageListener = listeners.get("message");
    expect(messageListener).toBeDefined();
    messageListener?.(
      DATAOPS_INTEGRATION_REDIS_CHANNEL,
      JSON.stringify({ revision: 7, pairingId: "pairing-fixed" }),
    );
    expect(provider.invalidate).toHaveBeenCalledWith(7);
  });

  it("keeps MySQL correctness available when Redis startup fails", async () => {
    const provider = { invalidate: vi.fn() };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const invalidation = createDataOpsIntegrationInvalidation({
      provider,
      subscriber: {
        on: vi.fn(),
        subscribe: vi.fn().mockRejectedValue(new Error("redis unavailable")),
        quit: vi.fn(),
      },
    });

    await expect(invalidation.start()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
