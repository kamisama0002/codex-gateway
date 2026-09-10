import { afterEach, describe, expect, it } from "vitest";
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

  it("omits developerInstructions when no gateway override is configured", () => {
    expect(buildAppServerThreadStartParams({ cwd: "/workspace" })).not.toHaveProperty(
      "developerInstructions",
    );
  });
});

describe("buildAppServerThreadStartParams developer instructions", () => {
  const original = process.env.GATEWAY_DEVELOPER_INSTRUCTIONS;

  afterEach(() => {
    if (original === undefined) delete process.env.GATEWAY_DEVELOPER_INSTRUCTIONS;
    else process.env.GATEWAY_DEVELOPER_INSTRUCTIONS = original;
  });

  it("injects the gateway-wide developer instructions on thread start", () => {
    process.env.GATEWAY_DEVELOPER_INSTRUCTIONS = "  你是前呈科技 Agent 平台的助手。  ";
    expect(buildAppServerThreadStartParams({ cwd: "/workspace" })).toMatchObject({
      developerInstructions: "你是前呈科技 Agent 平台的助手。",
    });
  });

  it("keeps a caller-provided developerInstructions over the gateway default", () => {
    process.env.GATEWAY_DEVELOPER_INSTRUCTIONS = "global";
    expect(
      buildAppServerThreadStartParams({ cwd: "/workspace", developerInstructions: "per-thread" }),
    ).toMatchObject({ developerInstructions: "per-thread" });
  });

  it("treats a blank gateway override as unconfigured", () => {
    process.env.GATEWAY_DEVELOPER_INSTRUCTIONS = "   ";
    expect(buildAppServerThreadStartParams({ cwd: "/workspace" })).not.toHaveProperty(
      "developerInstructions",
    );
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
