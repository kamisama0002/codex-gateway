import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GatewayEvent } from "~~/shared/types";

const harness = vi.hoisted(() => ({
  clearRequest: vi.fn(),
  maybeQueueServerOverloadedRetry: vi.fn(),
  emit: vi.fn(),
  setError: vi.fn(),
}));

vi.mock("@/stores/gateway-bootstrap", () => ({
  useGatewayBootstrapStore: () => ({
    t: (key: string) => key,
    setError: harness.setError,
  }),
}));
vi.mock("@/stores/gateway-thread-turns", () => ({
  useGatewayThreadTurnsStore: () => ({
    clearRequest: harness.clearRequest,
    maybeQueueServerOverloadedRetry: harness.maybeQueueServerOverloadedRetry,
  }),
}));
vi.mock("../domain-events", () => ({ gatewayDomainEvents: { emit: harness.emit } }));

import { errorEventHandlers } from "./error-events";

describe("app-server model error handling", () => {
  beforeEach(() => {
    harness.clearRequest.mockReset();
    harness.maybeQueueServerOverloadedRetry.mockReset().mockReturnValue(false);
    harness.emit.mockReset();
    harness.setError.mockReset();
  });

  it("ends a terminal provider failure and makes the error visible", () => {
    errorEventHandlers.error!(
      event(),
      {
        threadId: "thread-1",
        turnId: "turn-1",
        willRetry: false,
        error: {
          message: "Model unavailable",
          codexErrorInfo: { responseTooManyFailedAttempts: { httpStatusCode: 503 } },
          additionalDetails: null,
        },
      },
      "thread-1",
    );

    expect(harness.clearRequest).toHaveBeenCalledWith(1, "thread-1");
    expect(harness.emit).toHaveBeenCalledWith("thread-status-detected", {
      hostId: 1,
      threadId: "thread-1",
      status: "failed",
      phase: "failed",
      turnId: "turn-1",
    });
    expect(harness.setError).toHaveBeenCalledWith(
      expect.stringContaining("Model unavailable"),
      expect.objectContaining({ toast: true, retryable: false, threadId: "thread-1" }),
    );
  });

  it("keeps a retrying provider failure transient", () => {
    errorEventHandlers.error!(
      event(),
      {
        threadId: "thread-1",
        turnId: "turn-1",
        willRetry: true,
        error: {
          message: "Temporary provider outage",
          codexErrorInfo: { responseStreamDisconnected: { httpStatusCode: 503 } },
          additionalDetails: null,
        },
      },
      "thread-1",
    );

    expect(harness.clearRequest).not.toHaveBeenCalled();
    expect(harness.emit).toHaveBeenCalledWith("thread-status-detected", {
      hostId: 1,
      threadId: "thread-1",
      status: "running",
      phase: "retrying",
      turnId: "turn-1",
    });
    expect(harness.setError).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ toast: false, transient: true, retryable: true }),
    );
  });

  it("terminates realtime errors instead of leaving a turn running", () => {
    errorEventHandlers["thread/realtime/error"]!(
      event(),
      { threadId: "thread-1", message: "Realtime model channel failed" },
      "thread-1",
    );

    expect(harness.clearRequest).toHaveBeenCalledWith(1, "thread-1");
    expect(harness.emit).toHaveBeenCalledWith("thread-status-detected", {
      hostId: 1,
      threadId: "thread-1",
      status: "failed",
      phase: "failed",
    });
    expect(harness.setError).toHaveBeenCalledWith("Realtime model channel failed", {
      hostId: 1,
      threadId: "thread-1",
      category: "unavailable",
      toast: true,
    });
  });
});

function event(): GatewayEvent {
  return {
    id: 1,
    hostId: 1,
    threadId: "thread-1",
    method: "error",
    payload: { method: "error", params: {} },
    createdAt: "2026-09-09T00:00:00.000Z",
  };
}
