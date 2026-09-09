import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GatewayEvent } from "~~/shared/types";

const harness = vi.hoisted(() => ({
  clearRequest: vi.fn(),
  maybeRetryAfterTurnFailure: vi.fn(),
  emit: vi.fn(),
  setError: vi.fn(),
  errorForScope: vi.fn(),
  t: vi.fn((key: string) => key),
}));

vi.mock("@/stores/gateway-thread-turns", () => ({
  useGatewayThreadTurnsStore: () => ({
    clearRequest: harness.clearRequest,
    maybeRetryAfterTurnFailure: harness.maybeRetryAfterTurnFailure,
  }),
}));
vi.mock("@/stores/gateway-bootstrap", () => ({
  useGatewayBootstrapStore: () => ({
    setError: harness.setError,
    errorForScope: harness.errorForScope,
    t: harness.t,
  }),
}));
vi.mock("../domain-events", () => ({ gatewayDomainEvents: { emit: harness.emit } }));

import { turnEventHandlers } from "./turn-events";

describe("turn completion state", () => {
  beforeEach(() => {
    harness.clearRequest.mockReset();
    harness.maybeRetryAfterTurnFailure.mockReset();
    harness.emit.mockReset();
    harness.setError.mockReset();
    harness.errorForScope.mockReset().mockReturnValue(null);
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
    expect(harness.setError).toHaveBeenCalledWith(
      expect.stringContaining("app.appServerError"),
      expect.objectContaining({ hostId: 1, threadId: "thread-1", toast: true, retryable: false }),
    );
  });

  it("surfaces a fallback when a failed completion omits the error payload", () => {
    turnEventHandlers["turn/completed"]!(
      event(),
      {
        turn: {
          id: "turn-1",
          items: [],
          itemsView: "full",
          status: "failed",
          error: null,
          startedAt: null,
          completedAt: null,
          durationMs: null,
        },
      },
      "thread-1",
    );

    expect(harness.maybeRetryAfterTurnFailure).toHaveBeenCalledOnce();
    expect(harness.setError).toHaveBeenCalledWith(
      expect.stringContaining("app.appServerError"),
      expect.objectContaining({ turnId: "turn-1", toast: true, retryable: false }),
    );
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
