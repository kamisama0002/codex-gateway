import { describe, expect, it, vi } from "vitest";
import type { HostRecord } from "~~/shared/types";
import { MANAGED_RUNTIME_HOST_ID } from "~~/shared/runtime/managed-runtime";
import { TmuxCommandExecutor } from "./command-executor";

const managedHost: HostRecord = {
  id: MANAGED_RUNTIME_HOST_ID,
  connectionKind: "managed",
  name: "Local",
  sshHost: "localhost",
  username: null,
  port: null,
  authMode: "agent",
  privateKeyPath: null,
  privateKey: null,
  password: null,
  proxyUrl: null,
  hasPassword: false,
  createdAt: "2026-09-08T00:00:00.000Z",
  updatedAt: "2026-09-08T00:00:00.000Z",
};

describe("TmuxCommandExecutor", () => {
  it("executes managed Agent tmux commands in only the current user's container", async () => {
    const execManaged = vi.fn().mockResolvedValue({ code: 0, stdout: "ok", stderr: "" });
    const execSsh = vi.fn();
    const executor = new TmuxCommandExecutor({
      currentUserId: () => 17,
      execManaged,
      execSsh,
      runSshBackground: (_host, task) => task(),
    });

    await expect(
      executor.exec(managedHost, "tmux list-panes", {
        timeoutMs: 45_000,
        maxOutputBytes: 4_194_304,
      }),
    ).resolves.toEqual({ code: 0, stdout: "ok", stderr: "" });

    expect(execManaged).toHaveBeenCalledWith(17, "tmux list-panes", {
      timeoutMs: 45_000,
      maxOutputBytes: 4_194_304,
    });
    expect(execSsh).not.toHaveBeenCalled();
  });

  it("fails closed when a managed command has no authenticated Gateway user", async () => {
    const executor = new TmuxCommandExecutor({
      currentUserId: () => null,
      execManaged: vi.fn(),
      execSsh: vi.fn(),
      runSshBackground: (_host, task) => task(),
    });

    await expect(
      executor.exec(managedHost, "tmux list-panes", {
        timeoutMs: 45_000,
        maxOutputBytes: 4_194_304,
      }),
    ).rejects.toThrow("Gateway user context is required for managed tmux");
  });
});
