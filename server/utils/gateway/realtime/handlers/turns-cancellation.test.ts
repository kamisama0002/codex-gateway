import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RealtimeClientMessage } from "~~/shared/types";
import type { RealtimePeer } from "../peer-state";

const broker = vi.hoisted(() => ({ interruptTurn: vi.fn() }));
const startTurnFromRealtime = vi.hoisted(() => vi.fn());
const steerTurnFromRealtime = vi.hoisted(() => vi.fn());

vi.mock("../../runtime/broker", () => ({ threadBroker: broker }));
vi.mock("../turn-start", () => ({ startTurnFromRealtime }));
vi.mock("../turn-steer", () => ({ steerTurnFromRealtime }));
vi.mock("../../runtime-manager/local-workspace", () => ({
  requireWorkspaceHost: vi.fn(() => Promise.resolve({ id: 1, name: "Host" })),
}));

import { startTurn } from "./turns";

describe("cancelled turn submission", () => {
  beforeEach(() => {
    broker.interruptTurn.mockReset().mockResolvedValue(undefined);
    startTurnFromRealtime.mockReset();
    steerTurnFromRealtime.mockReset();
  });

  it("interrupts a turn accepted after its browser request was cancelled", async () => {
    let finishStart: ((value: { turn: { id: string } }) => void) | undefined;
    startTurnFromRealtime.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishStart = resolve;
        }),
    );
    const send = vi.fn();
    const peer: RealtimePeer = { send, close: () => {}, context: {} };
    const request: Extract<RealtimeClientMessage, { type: "turn.start" }> = {
      type: "turn.start",
      requestId: "request-1",
      hostId: 1,
      projectId: 2,
      threadId: "thread-1",
      text: "run",
    };
    const controller = new AbortController();
    const running = startTurn(peer, request, controller.signal);
    await vi.waitFor(() => expect(startTurnFromRealtime).toHaveBeenCalledOnce());

    controller.abort();
    finishStart?.({ turn: { id: "turn-1" } });
    await running;

    expect(broker.interruptTurn).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1 }),
      "thread-1",
      "turn-1",
    );
    expect(send).not.toHaveBeenCalled();
  });

  it("interrupts the active turn when a steer is accepted after cancellation", async () => {
    let finishSteer: ((value: { turnId: string }) => void) | undefined;
    steerTurnFromRealtime.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishSteer = resolve;
        }),
    );
    const send = vi.fn();
    const peer: RealtimePeer = { send, close: () => {}, context: {} };
    const request: Extract<RealtimeClientMessage, { type: "turn.steer" }> = {
      type: "turn.steer",
      requestId: "request-2",
      hostId: 1,
      projectId: 2,
      threadId: "thread-1",
      expectedTurnId: "turn-1",
      text: "change direction",
    };
    const controller = new AbortController();
    const { steerTurn } = await import("./turns");
    const running = steerTurn(peer, request, controller.signal);
    await vi.waitFor(() => expect(steerTurnFromRealtime).toHaveBeenCalledOnce());

    controller.abort();
    finishSteer?.({ turnId: "turn-1" });
    await running;

    expect(broker.interruptTurn).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1 }),
      "thread-1",
      "turn-1",
    );
    expect(send).not.toHaveBeenCalled();
  });
});
