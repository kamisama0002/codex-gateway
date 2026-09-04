import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RealtimeClientMessage } from "~~/shared/types";
import { createRealtimeRequestBroker } from "./request-broker";
import { RealtimeRequestError } from "./request-errors";

describe("createRealtimeRequestBroker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("window", globalThis);
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("rejects an aborted request immediately, removes its listener, and ignores a late response", async () => {
    const sent: RealtimeClientMessage[] = [];
    const controller = new AbortController();
    const removeEventListener = vi.spyOn(controller.signal, "removeEventListener");
    let markSent: (() => void) | undefined;
    const sentRequest = new Promise<void>((resolve) => {
      markSent = resolve;
    });
    const broker = createRealtimeRequestBroker({
      waitForReady: async () => {},
      send: (message) => {
        sent.push(message);
        markSent?.();
        return true;
      },
      unavailableMessage: () => "unavailable",
      timeoutMessage: () => "timed out",
      requestContext: () => ({}),
    });

    const request = broker.request(
      (requestId) => ({ type: "browser.close", requestId, sessionId: "session-1" }),
      { signal: controller.signal },
    );
    await sentRequest;
    const listenerRemovalsBeforeAbort = removeEventListener.mock.calls.length;

    controller.abort();

    await expect(request).rejects.toMatchObject({ reason: "aborted" });
    expect(removeEventListener).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(removeEventListener).toHaveBeenCalledTimes(listenerRemovalsBeforeAbort + 1);
    expect(vi.getTimerCount()).toBe(0);

    const outbound = sent[0];
    expect(outbound).toMatchObject({ type: "browser.close" });
    if (outbound === undefined || !("requestId" in outbound)) {
      throw new Error("Expected a realtime request id");
    }
    broker.resolveRequest({
      type: "browser.closed",
      requestId: outbound.requestId,
      sessionId: "session-1",
    });
    expect(broker.rejectRequest(outbound.requestId, new Error("late rejection"))).toEqual({
      delivered: false,
      notify: true,
    });
    await Promise.resolve();
    await expect(request).rejects.toBeInstanceOf(RealtimeRequestError);
  });

  it("removes the abort listener when the request times out", async () => {
    const controller = new AbortController();
    const removeEventListener = vi.spyOn(controller.signal, "removeEventListener");
    let markSent: (() => void) | undefined;
    const sentRequest = new Promise<void>((resolve) => {
      markSent = resolve;
    });
    const broker = createRealtimeRequestBroker({
      waitForReady: async () => {},
      send: () => {
        markSent?.();
        return true;
      },
      unavailableMessage: () => "unavailable",
      timeoutMessage: () => "timed out",
      requestContext: () => ({}),
    });

    const request = broker.request(
      (requestId) => ({ type: "browser.close", requestId, sessionId: "session-1" }),
      { signal: controller.signal, timeoutMs: 10 },
    );
    await sentRequest;
    const listenerRemovalsBeforeTimeout = removeEventListener.mock.calls.length;
    const rejected = expect(request).rejects.toMatchObject({ reason: "timeout" });

    await vi.advanceTimersByTimeAsync(10);

    await rejected;
    expect(removeEventListener).toHaveBeenCalledTimes(listenerRemovalsBeforeTimeout + 1);
  });
});
