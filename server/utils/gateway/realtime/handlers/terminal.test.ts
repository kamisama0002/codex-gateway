import { beforeEach, describe, expect, it, vi } from "vitest";
import { MANAGED_RUNTIME_HOST_ID } from "~~/shared/runtime/managed-runtime";
import { stateFor, type RealtimePeer } from "../peer-state";
import { openTerminal } from "./terminal";

const { terminalTarget, managedOpen, openManaged, start } = vi.hoisted(() => ({
  terminalTarget: vi.fn(),
  managedOpen: vi.fn(),
  openManaged: vi.fn(),
  start: vi.fn(),
}));

vi.mock("../../runtime-manager/runtime-service", () => ({
  runtimeService: { start, terminalTarget },
}));
vi.mock("../../terminal/managed-terminal-channel", () => ({
  ManagedTerminalChannel: { open: managedOpen },
}));
vi.mock("../../terminal/terminal-manager", () => ({
  terminalManager: { openManaged },
}));

describe("realtime terminal handler", () => {
  beforeEach(() => vi.clearAllMocks());

  it("opens managed terminals through the runtime manager", async () => {
    const peer = createPeer(42);
    const channel = { close: vi.fn() };
    const session = {
      sessionId: "session-1",
      hostId: MANAGED_RUNTIME_HOST_ID,
      projectId: null,
      threadId: null,
      cwd: "/workspace",
      title: "Agent Runtime terminal",
      scope: "host" as const,
      cols: 80,
      rows: 24,
      createdAt: "2026-09-09T00:00:00.000Z",
      lastActiveAt: "2026-09-09T00:00:00.000Z",
      status: "open" as const,
      output: "",
    };
    terminalTarget.mockResolvedValueOnce({
      runtimeId: "runtime-42",
      websocketUrl: "ws://runtime-manager/terminal",
      headers: () => ({ "x-runtime-signature": "signed" }),
    });
    managedOpen.mockResolvedValueOnce(channel);
    openManaged.mockReturnValueOnce(session);
    start.mockResolvedValueOnce({ status: "ready" });

    await openTerminal(peer, {
      type: "terminal.open",
      requestId: "request-1",
      hostId: MANAGED_RUNTIME_HOST_ID,
      projectId: null,
      threadId: null,
      cwd: null,
      title: null,
      scope: "host",
      cols: 80,
      rows: 24,
    });

    expect(terminalTarget).toHaveBeenCalledWith(42);
    expect(start).toHaveBeenCalledWith(42);
    expect(managedOpen).toHaveBeenCalledWith(
      expect.objectContaining({ runtimeId: "runtime-42" }),
      expect.objectContaining({ type: "open", cwd: "/workspace", cols: 80, rows: 24 }),
    );
    expect(openManaged).toHaveBeenCalledWith(
      42,
      expect.objectContaining({ hostId: MANAGED_RUNTIME_HOST_ID, cwd: "/workspace" }),
      channel,
    );
    expect(peer.messages).toContainEqual(
      expect.objectContaining({ type: "terminal.opened", requestId: "request-1", session }),
    );
  });

  it("rejects a managed terminal cwd outside the runtime workspace", async () => {
    const peer = createPeer(42);

    await expect(
      openTerminal(peer, {
        type: "terminal.open",
        requestId: "request-2",
        hostId: MANAGED_RUNTIME_HOST_ID,
        projectId: null,
        threadId: null,
        cwd: "/workspace/../etc",
        title: null,
        scope: "host",
        cols: 80,
        rows: 24,
      }),
    ).rejects.toThrow("must stay within /workspace");
    expect(terminalTarget).not.toHaveBeenCalled();
    expect(managedOpen).not.toHaveBeenCalled();
  });
});

function createPeer(userId: number): RealtimePeer & { messages: unknown[] } {
  const messages: unknown[] = [];
  const peer = {
    messages,
    send: (message: string) => messages.push(JSON.parse(message)),
    close: vi.fn(),
    context: {},
  };
  stateFor(peer).authenticated = true;
  stateFor(peer).userId = userId;
  return peer;
}
