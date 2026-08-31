import { describe, expect, it, vi } from "vitest";
import type { StartTurnInput } from "@codex-gateway/agent-runtime-contracts";
import type { HostRecord } from "~~/shared/types";
import { MANAGED_RUNTIME_HOST_ID } from "~~/shared/runtime/managed-runtime";
import { currentGatewayUserId } from "../state/memory";
import { createManagedRuntimeHost } from "../infra/rpc/managed-rpc-transport";
import { CodexAppServerDriver } from "./codex-runtime-driver";

describe("CodexAppServerDriver", () => {
  it("maps platform IDs to the authenticated user's hidden host and ignores caller host data", async () => {
    const host = createManagedRuntimeHost(
      7,
      {
        createdAt: "2026-08-31T00:00:00.000Z",
        updatedAt: "2026-08-31T00:00:00.000Z",
      },
      {
        runtimeId: "runtime_01",
        websocketUrl: "ws://runtime-01:4500",
        serviceToken: "real-runtime-token",
      },
    );
    const startTurn = vi.fn(
      async (resolvedHost: HostRecord, threadId: string, input: { text: string }) => {
        expect(currentGatewayUserId()).toBe(7);
        expect(resolvedHost).toBe(host);
        expect(threadId).toBe("conversation-1");
        expect(input).toMatchObject({ text: "hello managed runtime" });
        return {
          turn: {
            id: "turn-1",
            items: [],
            itemsView: "full",
            status: "inProgress",
            error: null,
          },
        };
      },
    );
    const driver = new CodexAppServerDriver({
      runtimeService: {
        start: vi.fn(async () => runtimeStatus()),
        resolveManagedHost: vi.fn(async () => host),
      },
      broker: { startTurn },
      now: () => new Date("2026-08-31T00:00:01.000Z"),
    });
    const input = {
      userId: 7,
      conversationId: "conversation-1",
      input: [
        {
          id: "item-1",
          kind: "userMessage",
          createdAt: "2026-08-31T00:00:00.000Z",
          data: { text: "hello managed runtime" },
        },
      ],
      host: { id: 99, password: "caller-controlled-secret" },
    } as StartTurnInput & { host: { id: number; password: string } };

    const result = await driver.startTurn(input);

    expect(result).toEqual({
      id: "turn-1",
      conversationId: "conversation-1",
      status: "running",
      createdAt: "2026-08-31T00:00:01.000Z",
    });
    const resolvedHost = startTurn.mock.calls[0]?.[0];
    expect(resolvedHost).toMatchObject({
      id: MANAGED_RUNTIME_HOST_ID,
      connectionKind: "managed",
      password: null,
      privateKey: null,
    });
    expect(JSON.stringify(resolvedHost)).not.toContain("real-runtime-token");
    expect(JSON.stringify(resolvedHost)).not.toContain("runtime-01:4500");
    expect(JSON.stringify(resolvedHost)).not.toContain("caller-controlled-secret");
  });

  it("maps conversation, read, interrupt, approval, and capability operations at the platform boundary", async () => {
    const host = createManagedRuntimeHost(
      7,
      {
        createdAt: "2026-08-31T00:00:00.000Z",
        updatedAt: "2026-08-31T00:00:00.000Z",
      },
      {
        runtimeId: "runtime_01",
        websocketUrl: "ws://runtime-01:4500",
        serviceToken: "real-runtime-token",
      },
    );
    const startThread = vi.fn(async () => ({
      thread: {
        id: "conversation-2",
        createdAt: 1_788_134_400,
      },
    }));
    const openThread = vi.fn(async () => ({
      thread: {
        id: "conversation-2",
        createdAt: 1_788_134_400,
      },
      history: {
        thread: {
          id: "conversation-2",
          turns: [
            {
              id: "turn-2",
              status: "completed",
              startedAt: "2026-08-31T00:00:02.000Z",
              items: [
                {
                  id: "item-2",
                  type: "agentMessage",
                  text: "response",
                },
              ],
            },
          ],
        },
      },
    }));
    const interruptTurn = vi.fn(async () => undefined);
    const respondToServerRequest = vi.fn(async () => undefined);
    const driver = new CodexAppServerDriver({
      runtimeService: {
        start: vi.fn(async () => runtimeStatus()),
        resolveManagedHost: vi.fn(async () => host),
      },
      broker: { startThread, openThread, interruptTurn, respondToServerRequest },
      now: () => new Date("2026-08-31T00:00:03.000Z"),
    });

    expect(await driver.ensureReady(7)).toEqual({
      userId: 7,
      runtimeType: "codex-app-server",
      status: "ready",
    });
    expect(await driver.getCapabilities(await driver.ensureReady(7))).toEqual({
      runtimeType: "codex-app-server",
      capabilities: { conversations: true, turns: true, approvals: true },
      checkedAt: "2026-08-31T00:00:03.000Z",
    });
    expect(await driver.startConversation({ userId: 7, metadata: { cwd: "/workspace" } })).toEqual({
      id: "conversation-2",
      userId: 7,
      createdAt: "2026-08-31T00:00:00.000Z",
    });
    expect(startThread).toHaveBeenCalledWith(host, { cwd: "/workspace" }, null);

    const snapshot = await driver.readConversation({ userId: 7, conversationId: "conversation-2" });
    expect(snapshot).toEqual({
      conversation: {
        id: "conversation-2",
        userId: 7,
        createdAt: "2026-08-31T00:00:00.000Z",
      },
      items: [
        {
          id: "item-2",
          kind: "agentMessage",
          createdAt: "2026-08-31T00:00:02.000Z",
          data: { id: "item-2", type: "agentMessage", text: "response" },
        },
      ],
    });

    await driver.interruptTurn({ userId: 7, conversationId: "conversation-2", turnId: "turn-2" });
    expect(interruptTurn).toHaveBeenCalledWith(host, "conversation-2", "turn-2");
    await driver.respondToApproval({
      userId: 7,
      conversationId: "conversation-2",
      approvalId: "approval-2",
      approved: false,
    });
    expect(respondToServerRequest).toHaveBeenCalledWith(host, "conversation-2", {
      requestId: "approval-2",
      result: { decision: "decline" },
    });
  });
});

function runtimeStatus() {
  return {
    userId: 7,
    hostId: MANAGED_RUNTIME_HOST_ID,
    runtimeType: "codex-app-server" as const,
    imageVersion: "0.151.0",
    runtimeVersion: "0.151.0",
    schemaHash: "schema-1",
    status: "ready" as const,
    lastError: null,
    createdAt: "2026-08-31T00:00:00.000Z",
    updatedAt: "2026-08-31T00:00:00.000Z",
  };
}
