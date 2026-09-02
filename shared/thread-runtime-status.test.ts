import { describe, expect, it } from "vitest";
import {
  runtimeStatusFromAuthoritativeThread,
  runtimeStatusFromSnapshotState,
} from "./thread-runtime-status";

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
    expect(
      runtimeStatusFromAuthoritativeThread({ id: "thread-1" }, inProgressHistory),
    ).toBe("running");
  });
});
