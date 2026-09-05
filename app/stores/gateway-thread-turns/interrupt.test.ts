import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  activeTurnId: null as string | null,
  cancelledRequest: null as Record<string, unknown> | null,
  trace: [] as string[],
}));

vi.mock("@/stores/gateway-bootstrap", () => ({
  useGatewayBootstrapStore: () => ({ clearError: vi.fn(), setError: vi.fn() }),
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
    threadRuntimeProjection: () => ({ activeTurnId: harness.activeTurnId }),
    setThreadStatus: (_hostId: number, _threadId: string, status: string) =>
      harness.trace.push(`status:${status}`),
  }),
}));
vi.mock("@/stores/gateway-thread-view", () => ({
  useGatewayThreadViewStore: () => ({ loading: false }),
}));
vi.mock("@/stores/gateway-thread-turns", () => ({
  useGatewayThreadTurnsStore: () => ({
    cancelRequest: () => {
      harness.trace.push("cancel");
      return harness.cancelledRequest;
    },
  }),
}));
vi.mock("./history", () => ({
  removeOptimisticUserMessage: (_hostId: number, _threadId: string, clientId: string) =>
    harness.trace.push(`remove:${clientId}`),
}));
vi.mock("./transport", () => ({
  requestTurnInterrupt: (_hostId: number, _threadId: string, turnId: string) => {
    harness.trace.push(`interrupt:${turnId}`);
    return Promise.resolve();
  },
}));

import { interruptThreadTurn } from "./interrupt";

describe("submission and turn interruption", () => {
  beforeEach(() => {
    harness.activeTurnId = null;
    harness.cancelledRequest = {
      clientUserMessageId: "message-1",
      previousStatus: "failed",
      admitted: false,
    };
    harness.trace.length = 0;
  });

  it("cancels a pending submission without inventing a completed turn", async () => {
    await interruptThreadTurn((key) => key, {
      hostId: 1,
      projectId: 2,
      threadId: "thread-1",
    });

    expect(harness.trace).toEqual(["cancel", "remove:message-1", "status:failed"]);
  });

  it("interrupts the authoritative turn after cancelling pending admission work", async () => {
    harness.activeTurnId = "turn-1";

    await interruptThreadTurn((key) => key, {
      hostId: 1,
      projectId: 2,
      threadId: "thread-1",
    });

    expect(harness.trace).toEqual(["cancel", "remove:message-1", "interrupt:turn-1"]);
  });

  it("keeps an admitted user message when stopping its authoritative turn", async () => {
    harness.activeTurnId = "turn-1";
    harness.cancelledRequest = {
      clientUserMessageId: "message-1",
      previousStatus: "completed",
      admitted: true,
    };

    await interruptThreadTurn((key) => key, {
      hostId: 1,
      projectId: 2,
      threadId: "thread-1",
    });

    expect(harness.trace).toEqual(["cancel", "interrupt:turn-1"]);
  });
});
