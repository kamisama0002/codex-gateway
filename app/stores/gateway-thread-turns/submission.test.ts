import { beforeEach, describe, expect, it, vi } from "vitest";

interface RuntimeFixture {
  status: "completed" | "running";
  canSteer: boolean;
  canInterrupt: boolean;
  activeTurnId: string | null;
}

const harness = vi.hoisted(() => ({
  errors: [] as string[],
  trace: [] as string[],
  receivedSignal: undefined as AbortSignal | undefined,
  acceptImmediately: false,
  runtime: {
    status: "completed",
    canSteer: false,
    canInterrupt: false,
    activeTurnId: null,
  } as RuntimeFixture,
  queueMessage: vi.fn(),
  requestTurnSteer: vi.fn(),
}));

vi.mock("@/stores/gateway-catalog", () => ({
  useGatewayCatalogStore: () => ({
    projects: [{ id: 2, remotePath: "/workspace/project" }],
  }),
}));
vi.mock("@/stores/gateway-bootstrap", () => ({
  useGatewayBootstrapStore: () => ({
    clearError: vi.fn(),
    setError: (message: string) => harness.errors.push(message),
  }),
}));
vi.mock("@/stores/gateway-composer", () => ({
  useGatewayComposerStore: () => ({ updateSelectedThreadSettings: vi.fn() }),
}));
vi.mock("@/stores/gateway-navigation", () => ({
  useGatewayNavigationStore: () => ({
    selectedHostId: 1,
    selectedProjectId: 2,
    selectedThreadId: "thread-1",
  }),
}));
vi.mock("@/stores/gateway-thread-runtime", () => ({
  useGatewayThreadRuntimeStore: () => ({
    threadRuntimeProjection: () => harness.runtime,
    setThreadStatus: (_hostId: number, _threadId: string, status: string) =>
      harness.trace.push(`status:${status}`),
  }),
}));
vi.mock("@/stores/gateway-thread-queue", () => ({
  useGatewayThreadQueueStore: () => ({ queueMessage: harness.queueMessage }),
}));
vi.mock("@/stores/gateway-thread-view", () => ({
  useGatewayThreadViewStore: () => ({ loading: false }),
}));
vi.mock("@/stores/gateway-thread-turns", () => ({
  useGatewayThreadTurnsStore: () => ({
    clearRequest: vi.fn(),
    markRequestAdmitted: () => harness.trace.push("admitted"),
  }),
}));
vi.mock("@/stores/gateway/thread-open/view-state", () => ({ requestScrollToLatest: vi.fn() }));
vi.mock("@/stores/gateway/thread-turns/turn-content", () => ({
  createClientUserMessageId: (kind: string) => (kind === "queue" ? "queue-1" : "message-1"),
  optimisticUserContent: () => [{ type: "text", text: "Run the report" }],
}));
vi.mock("./history", () => ({
  acceptStartedTurn: vi.fn(),
  insertOptimisticNewTurnMessage: () => harness.trace.push("insert:message-1"),
  insertOptimisticSteerMessage: vi.fn(),
  removeOptimisticUserMessage: () => harness.trace.push("remove:message-1"),
}));
vi.mock("./retry", () => ({
  runTurnRequestWithAutoRetry: (_t: unknown, _request: unknown, execute: () => Promise<unknown>) =>
    execute(),
}));
vi.mock("./transport", () => ({
  requestTurnSteer: harness.requestTurnSteer,
  requestTurnStart: (input: { signal?: AbortSignal }) => {
    harness.receivedSignal = input.signal;
    if (input.signal === undefined) return Promise.reject(new Error("Missing submission signal"));
    if (harness.acceptImmediately) {
      return Promise.resolve({ type: "turn.start.accepted" as const });
    }
    return new Promise((_resolve, reject) => {
      input.signal?.addEventListener(
        "abort",
        () =>
          reject(
            input.signal?.reason instanceof Error
              ? input.signal.reason
              : new Error("Submission cancelled"),
          ),
        { once: true },
      );
    });
  },
}));
vi.mock("@/utils/session-epoch", () => ({ captureSessionEpoch: () => () => true }));
vi.mock("@/stores/gateway/thread-utils/identity", () => ({
  errorMessageLabels: () => ({}),
  messageFromError: (error: unknown) => (error instanceof Error ? error.message : String(error)),
}));

import { sendTurn } from "./submission";

describe("turn submission cancellation", () => {
  beforeEach(() => {
    harness.errors.length = 0;
    harness.trace.length = 0;
    harness.receivedSignal = undefined;
    harness.acceptImmediately = false;
    harness.runtime = {
      status: "completed",
      canSteer: false,
      canInterrupt: false,
      activeTurnId: null,
    };
    harness.queueMessage.mockReset().mockResolvedValue({ id: "queue-1" });
    harness.requestTurnSteer.mockReset();
  });

  it("withdraws the optimistic message and restores status without showing an error", async () => {
    const controller = new AbortController();
    const pending = sendTurn((key) => key, "Run the report", {}, controller);
    await Promise.resolve();

    controller.abort(new Error("Submission cancelled"));
    const accepted = await pending;

    expect(harness.receivedSignal).toBe(controller.signal);
    expect(accepted).toBe(false);
    expect(harness.trace).toEqual([
      "status:running",
      "insert:message-1",
      "remove:message-1",
      "status:completed",
    ]);
    expect(harness.errors).toEqual([]);
  });

  it("marks an accepted admission before the turn becomes interruptible", async () => {
    harness.acceptImmediately = true;
    const controller = new AbortController();

    const accepted = await sendTurn((key) => key, "Run the report", {}, controller);

    expect(accepted).toBe(true);
    expect(harness.trace).toEqual(["status:running", "insert:message-1", "admitted"]);
  });

  it("queues a default submission while the current turn is active", async () => {
    harness.runtime = {
      status: "running",
      canSteer: true,
      canInterrupt: true,
      activeTurnId: "turn-active",
    };

    const accepted = await sendTurn((key) => key, "Run the report");

    expect(accepted).toBe(true);
    expect(harness.queueMessage).toHaveBeenCalledWith(
      1,
      "thread-1",
      expect.objectContaining({
        clientUserMessageId: "queue-1",
        input: [{ type: "text", text: "Run the report", text_elements: [] }],
      }),
      expect.any(AbortSignal),
    );
    expect(harness.requestTurnSteer).not.toHaveBeenCalled();
    expect(harness.trace).toEqual([]);
  });

  it("steers only when active delivery is explicitly accelerated", async () => {
    harness.runtime = {
      status: "running",
      canSteer: true,
      canInterrupt: true,
      activeTurnId: "turn-active",
    };
    harness.requestTurnSteer.mockResolvedValue({
      type: "turn.steer.accepted",
      turnId: "turn-active",
    });

    const accepted = await sendTurn((key) => key, "Correct the scope", {}, new AbortController(), {
      delivery: "steer",
    });

    expect(accepted).toBe(true);
    expect(harness.requestTurnSteer).toHaveBeenCalledOnce();
    expect(harness.queueMessage).not.toHaveBeenCalled();
  });
});
