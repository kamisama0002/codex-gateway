import { describe, expect, it, vi } from "vitest";

const controller = new AbortController();
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
  useGatewayCatalogStore: () => ({ projects: [{ id: 2, remotePath: "/workspace/project" }] }),
}));
vi.mock("@/stores/gateway-navigation", () => ({
  useGatewayNavigationStore: () => ({ selectedHostId: 1, selectedProjectId: 2 }),
}));

import { requestStartThread } from "./transport";

describe("thread creation transport cancellation", () => {
  it("passes the submission signal to thread.start", () => {
    const result = requestStartThread({}, { projectId: 2 }, controller.signal);

    expect(result).toMatchObject({ options: { signal: controller.signal } });
  });
});
