import { beforeEach, describe, expect, it, vi } from "vitest";
import { MANAGED_RUNTIME_HOST_ID } from "~~/shared/runtime/managed-runtime";

const testState = vi.hoisted(() => ({
  projects: [{ id: 7, hostId: 23, remotePath: "/workspace/project" }],
  navigation: {
    selectedHostId: 23,
    selectedProjectId: 7,
  },
  request: vi.fn().mockResolvedValue({}),
}));

vi.mock("@/stores/gateway-catalog", () => ({
  useGatewayCatalogStore: () => ({ projects: testState.projects }),
}));

vi.mock("@/stores/gateway-navigation", () => ({
  useGatewayNavigationStore: () => testState.navigation,
}));

vi.mock("@/stores/gateway-realtime", () => ({
  useGatewayRealtimeStore: () => ({ request: testState.request }),
}));

import { requestTurnStart } from "@/stores/gateway-thread-turns/transport";
import { requestActivateThreadSnapshot, requestStartThread } from "./transport";

describe("managed runtime request deadlines", () => {
  beforeEach(() => {
    testState.request.mockClear();
    testState.navigation.selectedHostId = 23;
    testState.navigation.selectedProjectId = 7;
  });

  it("uses 130000 ms for managed thread start, activation, and turn start", async () => {
    testState.navigation.selectedHostId = MANAGED_RUNTIME_HOST_ID;
    const controller = new AbortController();

    await requestStartThread({}, { projectId: 7 }, controller.signal);
    await requestActivateThreadSnapshot({
      hostId: MANAGED_RUNTIME_HOST_ID,
      projectId: 7,
      threadId: "thread-1",
    });
    await requestTurnStart({
      hostId: MANAGED_RUNTIME_HOST_ID,
      threadId: "thread-1",
      projectId: 7,
      text: "hello",
      clientUserMessageId: "client-message-1",
      cwd: "/workspace/project",
      options: {},
      signal: controller.signal,
    });

    const requestOptions: unknown[] = [];
    for (const call of testState.request.mock.calls) requestOptions.push(call[2]);
    expect(requestOptions).toEqual([
      { timeoutMs: 130_000, signal: controller.signal },
      { timeoutMs: 130_000 },
      { timeoutMs: 130_000, signal: controller.signal },
    ]);
  });

  it("leaves the broker deadline unchanged for SSH requests", async () => {
    const controller = new AbortController();

    await requestStartThread({}, { projectId: 7 }, controller.signal);
    await requestActivateThreadSnapshot({ hostId: 23, projectId: 7, threadId: "thread-1" });
    await requestTurnStart({
      hostId: 23,
      threadId: "thread-1",
      projectId: 7,
      text: "hello",
      clientUserMessageId: "client-message-1",
      cwd: "/workspace/project",
      options: {},
      signal: controller.signal,
    });

    const requestOptions: unknown[] = [];
    for (const call of testState.request.mock.calls) requestOptions.push(call[2]);
    expect(requestOptions).toEqual([
      { signal: controller.signal },
      undefined,
      { signal: controller.signal },
    ]);
  });
});
