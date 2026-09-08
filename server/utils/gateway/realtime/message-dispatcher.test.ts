import { describe, expect, it } from "vitest";
import { RealtimeMessageDispatcher } from "./message-dispatcher";
import { stateFor, type RealtimePeer } from "./peer-state";

describe("realtime request lifetimes", () => {
  it("aborts only the request named by a cancellation message", async () => {
    let requestSignal: AbortSignal | undefined;
    const dispatcher = new RealtimeMessageDispatcher({
      "thread.goal.get": (_peer, _request, signal) => {
        requestSignal = signal;
        return new Promise<void>((resolve) => {
          signal.addEventListener("abort", () => resolve(), { once: true });
        });
      },
    });
    const peer: RealtimePeer = { send: () => {}, close: () => {}, context: {} };
    Object.assign(stateFor(peer), { authenticated: true, userId: 1 });
    const running = Promise.resolve()
      .then(() =>
        dispatcher.dispatch(peer, {
          type: "thread.goal.get",
          requestId: "request-1",
          hostId: 1,
          threadId: "thread-1",
        }),
      )
      .catch((error: unknown) => error);
    await Promise.resolve();

    expect(requestSignal).toBeInstanceOf(AbortSignal);
    await dispatcher.dispatch(peer, {
      type: "request.cancel",
      targetRequestId: "request-1",
    });
    await running;

    expect(requestSignal?.aborted).toBe(true);
  });
});
