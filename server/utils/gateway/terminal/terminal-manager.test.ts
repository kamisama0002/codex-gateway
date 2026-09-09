import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { TerminalManager, type TerminalChannel } from "./terminal-manager";

describe("TerminalManager managed sessions", () => {
  it("keeps managed terminal I/O scoped to the owning user", () => {
    const manager = new TerminalManager();
    const channel = new FakeTerminalChannel();
    const session = manager.openManaged(
      7,
      {
        hostId: 2_000_000_000,
        projectId: 2_000_000_001,
        threadId: null,
        cwd: "/workspace",
        title: "workspace",
        scope: "project",
        cols: 80,
        rows: 24,
      },
      channel,
    );

    channel.emit("data", Buffer.from("ready\r\n"));
    expect(manager.list(7)[0]?.output).toBe("ready\r\n");
    expect(() => manager.input(8, session.sessionId, "pwd\r")).toThrow(
      "Terminal session not found",
    );
    manager.input(7, session.sessionId, "pwd\r");
    manager.resize(7, session.sessionId, 120, 40);
    expect(channel.write).toHaveBeenCalledWith("pwd\r");
    expect(channel.setWindow).toHaveBeenCalledWith(40, 120, 0, 0);
    manager.close(7, session.sessionId);
    expect(channel.close).toHaveBeenCalledOnce();
  });
});

class FakeTerminalChannel extends EventEmitter implements TerminalChannel {
  readonly stderr = new PassThrough();
  readonly write = vi.fn((_data: string) => true);
  readonly setWindow = vi.fn((_rows: number, _cols: number, _height: number, _width: number) => {});
  readonly close = vi.fn(() => {});
}
