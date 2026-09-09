import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GatewayEvent } from "~~/shared/types";

const harness = vi.hoisted(() => ({
  clearRequest: vi.fn(),
  emit: vi.fn(),
}));

vi.mock("@/stores/gateway-thread-turns", () => ({
  useGatewayThreadTurnsStore: () => ({ clearRequest: harness.clearRequest }),
}));
vi.mock("../domain-events", () => ({ gatewayDomainEvents: { emit: harness.emit } }));

import { turnEventHandlers } from "./turn-events";

describe("turn completion state", () => {
  beforeEach(() => {
    harness.clearRequest.mockReset();
    harness.emit.mockReset();
  });

  it("clears a pending submission when completion has no valid turn payload", () => {
    turnEventHandlers["turn/completed"]!(event(), { turn: { id: "turn-1" } }, "thread-1");

    expect(harness.clearRequest).toHaveBeenCalledWith(1, "thread-1");
    expect(harness.emit).toHaveBeenCalledWith("thread-status-detected", {
      hostId: 1,
      threadId: "thread-1",
      status: "failed",
      phase: "failed",
      turnId: null,
    });
  });
});

function event(): GatewayEvent {
  return {
    id: 1,
    hostId: 1,
    threadId: "thread-1",
    method: "turn/completed",
    payload: { method: "turn/completed", params: {} },
    createdAt: "2026-09-09T00:00:00.000Z",
  };
}
