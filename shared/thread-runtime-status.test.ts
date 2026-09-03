import { describe, expect, it } from "vitest";
import {
  runtimePhaseFromAppThreadStatus,
  runtimePhaseFromEvent,
  runtimeStatusFromAuthoritativeThread,
  runtimeStatusFromEvent,
  runtimeStatusFromSnapshotState,
} from "./thread-runtime-status";
import type { GatewayEvent } from "./types";

const idleThread = { id: "thread-1", status: { type: "idle" as const } };
const activeThread = {
  id: "thread-1",
  status: { type: "active" as const, activeFlags: [] },
};
const inProgressHistory = {
  thread: { id: "thread-1", turns: [{ id: "turn-1", status: "inProgress", items: [] }] },
};

describe("runtimeStatusFromAuthoritativeThread", () => {
  it("lets live idle win over cached inProgress history", () => {
    expect(runtimeStatusFromSnapshotState(idleThread, inProgressHistory)).toBe("running");
    expect(runtimeStatusFromAuthoritativeThread(idleThread, inProgressHistory)).toBe("completed");
  });

  it("keeps running when app-server thread.status is active", () => {
    expect(runtimeStatusFromAuthoritativeThread(activeThread, inProgressHistory)).toBe("running");
  });

  it("falls back to history when the live thread has no status", () => {
    expect(runtimeStatusFromAuthoritativeThread({ id: "thread-1" }, inProgressHistory)).toBe(
      "running",
    );
  });
});

describe("runtime activity phase", () => {
  it("preserves app-server approval and input flags", () => {
    expect(
      runtimePhaseFromAppThreadStatus({
        type: "active",
        activeFlags: ["waitingOnApproval"],
      }),
    ).toBe("waitingForApproval");
    expect(
      runtimePhaseFromAppThreadStatus({
        type: "active",
        activeFlags: ["waitingOnUserInput"],
      }),
    ).toBe("waitingForInput");
  });

  it("projects retry and server-request phases without losing the active status", () => {
    const retry = gatewayEvent("error", { willRetry: true, turnId: "turn-1" });
    const approval = gatewayEvent("item/permissions/requestApproval", {
      turnId: "turn-1",
    });
    expect(runtimePhaseFromEvent(retry)).toBe("retrying");
    expect(runtimeStatusFromEvent(retry)).toBe("running");
    expect(runtimePhaseFromEvent(approval)).toBe("waitingForApproval");
    expect(runtimeStatusFromEvent(approval)).toBe("running");
  });
});

function gatewayEvent(method: string, params: Record<string, unknown>): GatewayEvent {
  return {
    id: 1,
    hostId: 1,
    threadId: "thread-1",
    method,
    payload: { method, params },
    createdAt: "2026-09-03T00:00:00.000Z",
  };
}
