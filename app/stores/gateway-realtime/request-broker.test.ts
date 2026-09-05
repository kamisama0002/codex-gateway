import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RealtimeClientMessage } from "~~/shared/types";
import { createRealtimeRequestBroker } from "./request-broker";

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

  it("cancels one admitted server request and releases its browser resources", async () => {
    const messages: RealtimeClientMessage[] = [];
    const sent = deferred<void>();
    const waitForReady = vi.fn(() => Promise.resolve());
    const broker = createBroker({
      waitForReady,
      send: (message) => {
        messages.push(message);
        sent.resolve();
        return true;
      },
    });
    const controller = new AbortController();
    const removeEventListener = vi.spyOn(controller.signal, "removeEventListener");
    const pending = broker.request(closeBrowserMessage, {
      timeoutMs: 50,
      signal: controller.signal,
    });
    const settled = pending.catch((error: unknown) => error);
    await sent.promise;

    expect(waitForReady).toHaveBeenCalledWith(15_000, controller.signal);
    expect(messages).toHaveLength(1);
    const sentRequest = messages[0];
    if (sentRequest === undefined || !("requestId" in sentRequest)) {
      throw new Error("Expected an admitted realtime request");
    }

    controller.abort(new Error("Submission cancelled"));

    expect(await settled).toMatchObject({ reason: "cancelled" });
    expect(messages[1]).toEqual({
      type: "request.cancel",
      targetRequestId: sentRequest.requestId,
    });
    expect(removeEventListener).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);

    broker.resolveRequest({
      type: "browser.closed",
      requestId: sentRequest.requestId,
      sessionId: "session-1",
    });
    expect(await settled).toMatchObject({ reason: "cancelled" });
  });

  it("does not admit a request cancelled while realtime readiness is pending", async () => {
    const messages: RealtimeClientMessage[] = [];
    const waitForReady = vi.fn(
      (_timeoutMs: number, signal?: AbortSignal) =>
        new Promise<void>((resolve, reject) => {
          if (signal === undefined) {
            resolve();
            return;
          }
          signal.addEventListener(
            "abort",
            () =>
              reject(
                signal.reason instanceof Error
                  ? signal.reason
                  : new Error("Realtime readiness cancelled"),
              ),
            { once: true },
          );
        }),
    );
    const broker = createBroker({
      waitForReady,
      send: (message) => {
        messages.push(message);
        return true;
      },
    });
    const controller = new AbortController();
    const pending = broker.request(closeBrowserMessage, {
      timeoutMs: 50,
      signal: controller.signal,
    });
    const settled = pending.catch((error: unknown) => error);

    controller.abort(new Error("Submission cancelled"));

    expect(await settled).toMatchObject({ reason: "cancelled" });
    expect(waitForReady).toHaveBeenCalledWith(15_000, controller.signal);
    expect(messages).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels the admitted server request and removes its listener on timeout", async () => {
    const messages: RealtimeClientMessage[] = [];
    const sent = deferred<void>();
    const broker = createBroker({
      waitForReady: () => Promise.resolve(),
      send: (message) => {
        messages.push(message);
        sent.resolve();
        return true;
      },
    });
    const controller = new AbortController();
    const removeEventListener = vi.spyOn(controller.signal, "removeEventListener");
    const pending = broker.request(closeBrowserMessage, {
      timeoutMs: 10,
      signal: controller.signal,
    });
    const settled = pending.catch((error: unknown) => error);
    await sent.promise;

    await vi.advanceTimersByTimeAsync(10);

    expect(await settled).toMatchObject({ reason: "timeout" });
    const sentRequest = messages[0];
    if (sentRequest === undefined || !("requestId" in sentRequest)) {
      throw new Error("Expected an admitted realtime request");
    }
    expect(messages[1]).toEqual({
      type: "request.cancel",
      targetRequestId: sentRequest.requestId,
    });
    expect(removeEventListener).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
  });
});

function closeBrowserMessage(requestId: string) {
  return { type: "browser.close" as const, requestId, sessionId: "session-1" };
}

function createBroker(input: {
  waitForReady: (timeoutMs: number, signal?: AbortSignal) => Promise<void>;
  send: Parameters<typeof createRealtimeRequestBroker>[0]["send"];
}) {
  return createRealtimeRequestBroker({
    ...input,
    unavailableMessage: () => "Unavailable",
    timeoutMessage: () => "Timed out",
    requestContext: () => ({}),
  });
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
