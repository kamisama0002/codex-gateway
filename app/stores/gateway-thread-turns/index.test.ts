import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

vi.mock("./actions", () => ({ createGatewayThreadTurnActions: () => ({}) }));

import { useGatewayThreadTurnsStore } from "./index";

describe("thread submission ownership", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("cancels the controller and removes the pending request for one thread", () => {
    const store = useGatewayThreadTurnsStore();
    const controller = new AbortController();
    store.rememberRequest(requestInput("message-1"), controller);

    expect(store.cancelRequest(1, "thread-1")).toMatchObject({
      clientUserMessageId: "message-1",
    });
    expect(controller.signal.aborted).toBe(true);
    expect(store.requestForThread(1, "thread-1")).toBeUndefined();
  });

  it("aborts all pending submissions when the store resets", () => {
    const store = useGatewayThreadTurnsStore();
    const first = new AbortController();
    const second = new AbortController();
    store.rememberRequest(requestInput("message-1"), first);
    store.rememberRequest({ ...requestInput("message-2"), threadId: "thread-2" }, second);

    store.resetState();

    expect(first.signal.aborted).toBe(true);
    expect(second.signal.aborted).toBe(true);
  });
});

function requestInput(clientUserMessageId: string) {
  return {
    kind: "start" as const,
    hostId: 1,
    projectId: 2,
    threadId: "thread-1",
    cwd: "/workspace/project",
    text: "Run the report",
    clientUserMessageId,
    previousStatus: "completed" as const,
    options: {},
  };
}
