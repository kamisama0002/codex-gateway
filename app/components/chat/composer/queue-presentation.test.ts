import { describe, expect, it } from "vitest";
import type { QueuedSubmission } from "~~/shared/types";
import {
  editableQueuedText,
  moveQueuedSubmissionIds,
  queuedSubmissionPreview,
} from "./queue-presentation";

describe("composer queue presentation", () => {
  it("projects a compact preview and editable text for text-only input", () => {
    const item = submission("queue-1", [
      { type: "text", text: "first line", text_elements: [] },
      { type: "text", text: "second line", text_elements: [] },
    ]);

    expect(queuedSubmissionPreview(item, "Image")).toBe("first line second line");
    expect(editableQueuedText(item)).toBe("first line\nsecond line");
  });

  it("keeps a useful image preview but disables lossy text editing", () => {
    const item = submission("queue-1", [
      { type: "text", text: "inspect this", text_elements: [] },
      { type: "image", url: "data:image/png;base64,AA==" },
    ]);

    expect(queuedSubmissionPreview(item, "Image")).toBe("inspect this · Image");
    expect(editableQueuedText(item)).toBeNull();
  });

  it("moves one exact queue identity without losing its neighbors", () => {
    const items = [submission("queue-1", []), submission("queue-2", []), submission("queue-3", [])];

    expect(moveQueuedSubmissionIds(items, "queue-2", "up")).toEqual([
      "queue-2",
      "queue-1",
      "queue-3",
    ]);
    expect(moveQueuedSubmissionIds(items, "queue-2", "down")).toEqual([
      "queue-1",
      "queue-3",
      "queue-2",
    ]);
    expect(moveQueuedSubmissionIds(items, "queue-1", "up")).toEqual([
      "queue-1",
      "queue-2",
      "queue-3",
    ]);
  });
});

function submission(id: string, input: QueuedSubmission["input"]): QueuedSubmission {
  return { id, input, clientUserMessageId: `client-${id}` };
}
