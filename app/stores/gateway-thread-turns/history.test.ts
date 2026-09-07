import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ThreadHistoryState } from "~~/shared/types";

const harness = vi.hoisted(() => ({
  views: {
    history: null as ThreadHistoryState | null,
    currentThread: null,
    threadViews: {},
  },
}));

vi.mock("@/stores/gateway-thread-view", () => ({
  useGatewayThreadViewStore: () => harness.views,
}));
vi.mock("@/stores/gateway-navigation", () => ({
  useGatewayNavigationStore: () => ({ selectedHostId: null, selectedThreadId: null }),
}));
vi.mock("@/stores/gateway/thread-open/thread-view-cache", () => ({
  patchThreadView: vi.fn(),
  setSelectedThreadHistory: (history: typeof harness.views.history) => {
    harness.views.history = history;
  },
}));
vi.mock("@/stores/gateway/thread-open/view-state", () => ({ cacheSelectedThreadView: vi.fn() }));

import { insertOptimisticNewTurnMessage } from "./history";

describe("optimistic user message history", () => {
  beforeEach(() => {
    harness.views.history = { thread: { id: "thread-1", turns: [] } };
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-06T06:30:00.000Z"));
  });

  it("records the click-time timestamp on the immediately visible message", () => {
    insertOptimisticNewTurnMessage("thread-1", "client-message-1", [
      { type: "text", text: "查看营业额" },
    ]);

    expect(harness.views.history?.thread.turns[0]?.items?.[0]).toMatchObject({
      type: "userMessage",
      clientId: "client-message-1",
      startedAt: 1_788_676_200_000,
    });
  });
});
