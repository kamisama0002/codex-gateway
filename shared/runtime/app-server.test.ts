import { describe, expect, it } from "vitest";
import {
  parseThreadQueueAddResponse,
  parseThreadQueueDeleteResponse,
  parseThreadQueueListResponse,
  parseThreadQueueStartResponse,
  parseThreadQueueUpdateResponse,
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
