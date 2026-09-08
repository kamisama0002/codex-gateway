import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RealtimeClientMessage } from "~~/shared/types";
import { stateFor, type RealtimePeer } from "../peer-state";

const broker = vi.hoisted(() => ({
  deleteThread: vi.fn(),
  startThread: vi.fn(),
}));

vi.mock("../../runtime/broker", () => ({ threadBroker: broker }));
vi.mock("../../runtime-manager/local-workspace", () => ({
  requireWorkspaceHost: vi.fn(() => Promise.resolve({ id: 1, name: "Host" })),
}));

import { startThread } from "./thread-events";

describe("cancelled thread creation", () => {
  beforeEach(() => {
    broker.deleteThread.mockReset().mockResolvedValue(undefined);
    broker.startThread.mockReset();
  });

  it("deletes a late blank thread without publishing it to the browser", async () => {
    let finishStart: ((value: { thread: { id: string } }) => void) | undefined;
    broker.startThread.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishStart = resolve;
        }),
    );
    const send = vi.fn();
    const peer: RealtimePeer = { send, close: () => {}, context: {} };
    Object.assign(stateFor(peer), { authenticated: true, userId: 42 });
    const request: Extract<RealtimeClientMessage, { type: "thread.start" }> = {
      type: "thread.start",
      requestId: "request-1",
      hostId: 1,
      projectId: 2,
    };
    const controller = new AbortController();
    const running = startThread(peer, request, controller.signal);
    await vi.waitFor(() => expect(broker.startThread).toHaveBeenCalledOnce());

    controller.abort();
    finishStart?.({ thread: { id: "late-blank-thread" } });
    await running;

    expect(broker.deleteThread).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1 }),
      "late-blank-thread",
      42,
    );
    expect(send).not.toHaveBeenCalled();
  });
});
