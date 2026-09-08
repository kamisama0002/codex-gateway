import { describe, expect, it } from "vitest";
import { parseRealtimeServerMessage } from "../realtime";

const queuedSubmission = {
  id: "queue-1",
  input: [{ type: "text", text: "queued", text_elements: [] }],
  clientUserMessageId: "client-1",
};

describe("realtime thread queue responses", () => {
  it.each([
    {
      type: "thread.queue.snapshot",
      items: [queuedSubmission],
    },
    {
      type: "thread.queue.added",
      item: queuedSubmission,
    },
    {
      type: "thread.queue.updated",
      item: queuedSubmission,
    },
    {
      type: "thread.queue.deleted",
      queuedSubmissionId: "queue-1",
      deleted: true,
    },
    {
      type: "thread.queue.reordered",
      queuedSubmissionIds: ["queue-1"],
    },
    {
      type: "thread.queue.started",
      queuedSubmissionId: "queue-1",
      turn: {
        id: "turn-2",
        items: [],
        itemsView: "full",
        status: "inProgress",
        error: null,
        startedAt: 1,
        completedAt: null,
        durationMs: null,
      },
    },
    {
      type: "thread.queue.steered",
      queuedSubmissionId: "queue-1",
      turnId: "turn-active",
      deleted: true,
    },
  ])("accepts $type", (body) => {
    expect(
      parseRealtimeServerMessage({
        ...body,
        requestId: `request-${body.type}`,
        hostId: 1,
        threadId: "thread-1",
      }).type,
    ).toBe(body.type);
  });

  it("rejects a malformed queue snapshot item", () => {
    expect(() =>
      parseRealtimeServerMessage({
        type: "thread.queue.snapshot",
        requestId: "queue-list-1",
        hostId: 1,
        threadId: "thread-1",
        items: [{ ...queuedSubmission, id: "" }],
      }),
    ).toThrow();
  });
});
