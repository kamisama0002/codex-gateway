import { describe, expect, it } from "vitest";
import { findReusableEmptyThread } from "../../app/stores/gateway/thread-utils/identity";

describe("new conversation reuse", () => {
  it("selects the newest empty thread in the requested project", () => {
    const threads = [
      {
        id: "older-empty",
        hostId: 1,
        projectId: 10,
        turns: [],
        history: { thread: { id: "older-empty", turns: [] } },
        recencyAt: 100,
        updatedAt: 100,
      },
      {
        id: "newer-non-empty",
        hostId: 1,
        projectId: 10,
        turns: [],
        history: { thread: { id: "newer-non-empty", turns: [{ id: "turn-1" }] } },
        recencyAt: 400,
        updatedAt: 400,
      },
      {
        id: "other-project-empty",
        hostId: 1,
        projectId: 11,
        turns: [],
        history: { thread: { id: "other-project-empty", turns: [] } },
        recencyAt: 500,
        updatedAt: 500,
      },
      {
        id: "newest-empty",
        hostId: 1,
        projectId: 10,
        turns: [],
        history: { thread: { id: "newest-empty", turns: [] } },
        recencyAt: 300,
        updatedAt: 300,
      },
    ];
    const selected = findReusableEmptyThread(threads, { hostId: 1, projectId: 10 });

    expect(selected?.id).toBe("newest-empty");
  });
});
