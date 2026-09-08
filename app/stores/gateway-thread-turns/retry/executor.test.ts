import { afterEach, describe, expect, it, vi } from "vitest";
import { APP_SERVER_RPC_OVERLOADED_MESSAGE } from "@/stores/gateway/errors";

const harness = vi.hoisted(() => ({
  rememberRequest: vi.fn(),
  clearRequest: vi.fn(),
  patchRequest: vi.fn(),
  setError: vi.fn(),
  setThreadStatus: vi.fn(),
}));

vi.mock("@/stores/gateway-thread-turns", () => ({
  useGatewayThreadTurnsStore: () => ({
    rememberRequest: harness.rememberRequest,
    clearRequest: harness.clearRequest,
    patchRequest: harness.patchRequest,
    requestForThread: () => undefined,
    requestSignal: () => undefined,
  }),
}));
vi.mock("@/stores/gateway-bootstrap", () => ({
  useGatewayBootstrapStore: () => ({ setError: harness.setError, clearError: vi.fn() }),
}));
vi.mock("@/stores/gateway-thread-runtime", () => ({
  useGatewayThreadRuntimeStore: () => ({
    setThreadStatus: harness.setThreadStatus,
    threadRuntimeProjection: () => ({ activeTurnId: null }),
  }),
}));
vi.mock("@/stores/gateway/thread-turns/turn-content", () => ({
  createClientUserMessageId: () => "retry-message",
}));
vi.mock("../transport", () => ({ requestTurnStart: vi.fn(), requestTurnSteer: vi.fn() }));
vi.mock("../history", () => ({ upsertHistoryItem: vi.fn() }));

import { runTurnRequestWithAutoRetry } from "./executor";

describe("turn request retry cancellation", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("does not execute another request after cancellation during backoff", async () => {
    vi.useFakeTimers();
    const execute = vi.fn().mockRejectedValueOnce(new Error(APP_SERVER_RPC_OVERLOADED_MESSAGE));
    const controller = new AbortController();
    const pending = runTurnRequestWithAutoRetry(
      (key) => key,
      {
        kind: "start",
        hostId: 1,
        projectId: 2,
        threadId: "thread-1",
        cwd: "/workspace/project",
        text: "Run the report",
        clientUserMessageId: "message-1",
        previousStatus: "completed",
        options: {},
      },
      execute,
      controller,
    ).then(
      () => "resolved",
      () => "cancelled",
    );
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1));

    controller.abort(new Error("Submission cancelled"));
    await vi.advanceTimersByTimeAsync(0);

    expect(await Promise.race([pending, Promise.resolve("still waiting")])).toBe("cancelled");
    expect(execute).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
