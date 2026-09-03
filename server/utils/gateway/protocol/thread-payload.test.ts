import { describe, expect, it } from "vitest";
import {
  DEFAULT_THREAD_SANDBOX,
  MANAGED_RUNTIME_THREAD_SANDBOX,
  MANAGED_RUNTIME_TURN_SANDBOX_POLICY,
  buildAppServerThreadStartParams,
  buildTurnStartParams,
} from "./thread-payload";

describe("buildAppServerThreadStartParams", () => {
  it("defaults new threads to Desktop Agent workspace-write sandbox", () => {
    expect(buildAppServerThreadStartParams({ cwd: "/workspace" })).toEqual({
      cwd: "/workspace",
      sandbox: DEFAULT_THREAD_SANDBOX,
      historyMode: "paginated",
      experimentalRawEvents: true,
    });
    expect(DEFAULT_THREAD_SANDBOX).toBe("workspace-write");
  });

  it("skips inner bubblewrap for managed Docker Agent containers", () => {
    expect(
      buildAppServerThreadStartParams({ cwd: "/workspace" }, { managedRuntime: true }),
    ).toEqual({
      cwd: "/workspace",
      sandbox: MANAGED_RUNTIME_THREAD_SANDBOX,
      historyMode: "paginated",
      experimentalRawEvents: true,
    });
    expect(MANAGED_RUNTIME_THREAD_SANDBOX).toBe("danger-full-access");
  });

  it("keeps an explicit sandbox override", () => {
    expect(
      buildAppServerThreadStartParams({
        cwd: "/workspace",
        sandbox: "read-only",
      }).sandbox,
    ).toBe("read-only");
  });
});

describe("buildTurnStartParams", () => {
  it("does not override sandboxPolicy on SSH hosts", () => {
    expect(
      buildTurnStartParams("thread-1", "client-1", { text: "hello" }),
    ).not.toHaveProperty("sandboxPolicy");
  });

  it("uses externalSandbox for managed Docker Agent turns", () => {
    expect(
      buildTurnStartParams("thread-1", "client-1", { text: "hello" }, { managedRuntime: true }),
    ).toMatchObject({
      threadId: "thread-1",
      sandboxPolicy: MANAGED_RUNTIME_TURN_SANDBOX_POLICY,
    });
    expect(MANAGED_RUNTIME_TURN_SANDBOX_POLICY).toEqual({
      type: "externalSandbox",
      networkAccess: "enabled",
    });
  });
});
