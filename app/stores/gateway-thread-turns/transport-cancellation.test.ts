import { describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  request: vi.fn(
    (
      build: (requestId: string) => Record<string, unknown>,
      _parse: unknown,
      options?: { signal?: AbortSignal },
    ) => ({ message: build("request-1"), options }),
  ),
}));

vi.mock("@/stores/gateway-realtime", () => ({
  useGatewayRealtimeStore: () => ({ request: harness.request }),
}));
vi.mock("@/stores/gateway-catalog", () => ({
  useGatewayCatalogStore: () => ({ projects: [] }),
}));
vi.mock("@/stores/gateway-navigation", () => ({
  useGatewayNavigationStore: () => ({ selectedHostId: 1, selectedProjectId: 2 }),
}));

import { requestTurnStart, requestTurnSteer } from "./transport";

describe("turn transport cancellation", () => {
  it.each(["start", "steer"] as const)("passes the submission signal to turn.%s", (kind) => {
    const controller = new AbortController();
    const common = {
      hostId: 1,
      threadId: "thread-1",
      projectId: 2,
      text: "Run the report",
      clientUserMessageId: "message-1",
      options: {},
      signal: controller.signal,
    };

    const result =
      kind === "start"
        ? requestTurnStart({ ...common, cwd: "/workspace/project" })
        : requestTurnSteer({ ...common, expectedTurnId: "turn-1" });

    expect(result).toMatchObject({ options: { signal: controller.signal } });
  });
});
