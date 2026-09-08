import { describe, expect, it } from "vitest";
import {
  parseThreadQueueAddResponse,
  parseThreadQueueDeleteResponse,
  parseThreadQueueListResponse,
  parseThreadQueueStartResponse,
  parseThreadQueueUpdateResponse,
  parseThreadStartResult,
} from "./app-server";

const queuedSubmission = {
  id: "queue-1",
  input: [
    { type: "text", text: "check revenue", text_elements: [] },
    { type: "image", url: "data:image/png;base64,AA==", detail: "auto" },
  ],
  clientUserMessageId: "queue-message-1",
};

describe("App Server thread queue responses", () => {
  it("parses queue add, update, list, delete and start results", () => {
    expect(parseThreadQueueAddResponse({ queuedSubmission })).toEqual({ queuedSubmission });
    expect(parseThreadQueueUpdateResponse({ queuedSubmission })).toEqual({ queuedSubmission });
    expect(
      parseThreadQueueListResponse({ data: [queuedSubmission], nextCursor: "cursor-2" }),
    ).toEqual({ data: [queuedSubmission], nextCursor: "cursor-2" });
    expect(parseThreadQueueDeleteResponse({ deleted: true })).toEqual({ deleted: true });
    expect(
      parseThreadQueueStartResponse({
        turn: {
          id: "turn-queued",
          items: [],
          itemsView: "full",
          status: "inProgress",
          error: null,
          startedAt: 1,
          completedAt: null,
          durationMs: null,
        },
      }).turn.id,
    ).toBe("turn-queued");
  });

  it("rejects malformed queue identities and inputs", () => {
    expect(() =>
      parseThreadQueueAddResponse({
        queuedSubmission: { ...queuedSubmission, id: "" },
      }),
    ).toThrow();
    expect(() =>
      parseThreadQueueListResponse({
        data: [{ ...queuedSubmission, input: ["not-user-input"] }],
        nextCursor: null,
      }),
    ).toThrow();
  });
});

describe("App Server 0.153.4 thread responses", () => {
  it("parses current model and reasoning effort metadata", () => {
    const result = parseThreadStartResult({
      thread: {
        id: "01992f9c-e86c-76b0-b0f1-c96c09d71b38",
        extra: null,
        sessionId: "01992f9c-e86c-76b0-b0f1-c96c09d71b38",
        forkedFromId: null,
        parentThreadId: null,
        preview: "",
        ephemeral: false,
        section: null,
        sectionEnteredAt: null,
        projectId: null,
        historyMode: "paginated",
        model: "gpt-5.6-luna",
        reasoningEffort: "medium",
        modelProvider: "codex_gateway",
        createdAt: 1,
        updatedAt: 1,
        recencyAt: null,
        status: { type: "idle" },
        path: null,
        cwd: "/workspace",
        cliVersion: "0.153.4",
        name: null,
        source: "appServer",
        canAcceptDirectInput: true,
        threadSource: null,
        agentNickname: null,
        agentRole: null,
        gitInfo: null,
        turns: [],
      },
    });

    expect(result.thread).toMatchObject({
      model: "gpt-5.6-luna",
      reasoningEffort: "medium",
    });
  });
});
