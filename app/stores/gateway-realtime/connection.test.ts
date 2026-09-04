import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRealtimeConnection } from "./connection";

describe("createRealtimeConnection", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("window", globalThis);
    vi.stubGlobal("reactive", <T>(value: T) => value);
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("removes an unready waiter, timer, and listener immediately when aborted", async () => {
    const controller = new AbortController();
    const removeEventListener = vi.spyOn(controller.signal, "removeEventListener");
    const connection = createRealtimeConnection({
      disconnectedMessage: () => "disconnected",
      onMessage: () => {},
      onDisconnected: () => {},
    });
    let rejection: unknown;
    const ready = connection.waitForReady(15_000, controller.signal);
    void ready.catch((error: unknown) => {
      rejection = error;
    });
    expect(vi.getTimerCount()).toBe(1);

    controller.abort();
    await Promise.resolve();

    expect(rejection).toBe(controller.signal.reason);
    expect(vi.getTimerCount()).toBe(0);
    expect(removeEventListener).toHaveBeenCalledWith("abort", expect.any(Function));
  });
});
