import { describe, expect, it } from "vitest";
import { MANAGED_RUNTIME_HOST_ID } from "../managed-runtime";
import { parseRealtimeClientMessage } from "../realtime";

describe("realtime request cancellation message", () => {
  it("accepts a request cancellation with an opaque target request id", () => {
    expect(
      parseRealtimeClientMessage({
        type: "request.cancel",
        targetRequestId: "gateway-ws-request-1",
      }),
    ).toEqual({
      type: "request.cancel",
      targetRequestId: "gateway-ws-request-1",
    });
  });
});

describe("managed runtime tmux messages", () => {
  it("allows tmux session discovery on the local Docker Agent", () => {
    expect(
      parseRealtimeClientMessage({
        type: "tmux.sessions.subscribe",
        requestId: "tmux-local-1",
        hostId: MANAGED_RUNTIME_HOST_ID,
      }),
    ).toMatchObject({ type: "tmux.sessions.subscribe", hostId: MANAGED_RUNTIME_HOST_ID });
  });

  it("allows terminal access but keeps browser access disabled for the local Docker Agent", () => {
    expect(
      parseRealtimeClientMessage({
        type: "terminal.open",
        requestId: "terminal-local-1",
        hostId: MANAGED_RUNTIME_HOST_ID,
        projectId: null,
        threadId: null,
        cwd: "/workspace",
        title: null,
        scope: "host",
        cols: 80,
        rows: 24,
      }),
    ).toMatchObject({ type: "terminal.open", hostId: MANAGED_RUNTIME_HOST_ID });
    expect(() =>
      parseRealtimeClientMessage({
        type: "browser.open",
        requestId: "browser-local-1",
        hostId: MANAGED_RUNTIME_HOST_ID,
        projectId: null,
        threadId: null,
        panelId: "panel-local-1",
        targetUrl: "https://example.com",
      }),
    ).toThrow("This workspace action is not available on the local Agent");
  });
});

describe("realtime thread queue messages", () => {
  it("accepts official queue input and mutation requests", () => {
    expect(
      parseRealtimeClientMessage({
        type: "thread.queue.add",
        requestId: "queue-add-1",
        hostId: 1,
        threadId: "thread-1",
        clientUserMessageId: "client-1",
        input: [
          { type: "text", text: "run after the active turn", text_elements: [] },
          { type: "image", url: "data:image/png;base64,AA==", detail: "auto" },
        ],
      }),
    ).toMatchObject({ type: "thread.queue.add", clientUserMessageId: "client-1" });
    expect(
      parseRealtimeClientMessage({
        type: "thread.queue.reorder",
        requestId: "queue-reorder-1",
        hostId: 1,
        threadId: "thread-1",
        queuedSubmissionIds: ["queue-2", "queue-1"],
      }),
    ).toMatchObject({ queuedSubmissionIds: ["queue-2", "queue-1"] });
    expect(
      parseRealtimeClientMessage({
        type: "thread.queue.steer",
        requestId: "queue-steer-1",
        hostId: 1,
        threadId: "thread-1",
        queuedSubmissionId: "queue-1",
        expectedTurnId: "turn-active",
      }),
    ).toMatchObject({ type: "thread.queue.steer", queuedSubmissionId: "queue-1" });
  });

  it("rejects empty queue input and identities", () => {
    expect(() =>
      parseRealtimeClientMessage({
        type: "thread.queue.add",
        requestId: "queue-add-1",
        hostId: 1,
        threadId: "thread-1",
        clientUserMessageId: "client-1",
        input: [],
      }),
    ).toThrow();
    expect(() =>
      parseRealtimeClientMessage({
        type: "thread.queue.delete",
        requestId: "queue-delete-1",
        hostId: 1,
        threadId: "thread-1",
        queuedSubmissionId: "",
      }),
    ).toThrow();
  });
});
