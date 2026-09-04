import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RealtimeClientMessage } from "~~/shared/types";
import { createRealtimeRequestBroker } from "./request-broker";

describe("realtime request cancellation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("window", {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("rejects an admitted request and notifies the server when its signal aborts", async () => {
    const messages: RealtimeClientMessage[] = [];
    const broker = createBroker({
      waitForReady: () => Promise.resolve(),
      send: (message) => {
        messages.push(message);
        return true;
      },
    });
    const controller = new AbortController();
    const pending = broker.request(requestMessage, {
      timeoutMs: 50,
      signal: controller.signal,
    });
    const settled = pending.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(0);
    expect(messages).toHaveLength(1);

    controller.abort();
    await vi.advanceTimersByTimeAsync(50);

    expect(await settled).toMatchObject({ reason: "cancelled" });
    const sentRequest = messages[0];
    if (sentRequest === undefined || !("requestId" in sentRequest)) {
      throw new Error("Expected an admitted realtime request");
    }
    expect(messages[1]).toEqual({
      type: "request.cancel",
      targetRequestId: sentRequest.requestId,
    });
  });

  it("does not send a request that aborts before the connection becomes ready", async () => {
    let releaseReady = () => {};
    const messages: RealtimeClientMessage[] = [];
    const broker = createBroker({
      waitForReady: () =>
        new Promise<void>((resolve) => {
          releaseReady = resolve;
        }),
      send: (message) => {
        messages.push(message);
        return true;
      },
    });
    const controller = new AbortController();
    const pending = broker.request(requestMessage, {
      timeoutMs: 50,
      signal: controller.signal,
    });
    const settled = pending.catch((error: unknown) => error);

    controller.abort();
    releaseReady();
    await vi.advanceTimersByTimeAsync(50);

    expect(await settled).toMatchObject({ reason: "cancelled" });
    expect(messages).toEqual([]);
  });
});

function requestMessage(requestId: string) {
  return {
    type: "thread.goal.get" as const,
    requestId,
    hostId: 1,
    threadId: "thread-1",
  };
}

function createBroker(input: {
  waitForReady: (timeoutMs: number) => Promise<void>;
  send: Parameters<typeof createRealtimeRequestBroker>[0]["send"];
}) {
  return createRealtimeRequestBroker({
    ...input,
    unavailableMessage: () => "Unavailable",
    timeoutMessage: () => "Timed out",
    requestContext: () => ({}),
  });
}
