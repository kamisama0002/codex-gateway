import { describe, expect, it } from "vitest";
import * as historyItems from "./items";
import type { ThreadHistoryState } from "./types";

describe("optimistic user message cancellation", () => {
  it("removes the empty synthetic turn created for a cancelled new turn", () => {
    const history: ThreadHistoryState = {
      thread: {
        id: "thread-1",
        turns: [
          { id: "turn-1", items: [{ id: "answer-1", type: "agentMessage" }] },
          {
            id: "client-message-1",
            items: [
              {
                id: "message-1",
                clientId: "message-1",
                type: "userMessage",
              },
            ],
          },
        ],
      },
    };

    expect(removeItem(history, "message-1").thread.turns).toEqual([
      { id: "turn-1", items: [{ id: "answer-1", type: "agentMessage" }] },
    ]);
  });

  it("keeps an authoritative turn when a cancelled steer message is removed", () => {
    const history: ThreadHistoryState = {
      thread: {
        id: "thread-1",
        turns: [
          {
            id: "turn-1",
            status: "inProgress",
            items: [
              { id: "answer-1", type: "agentMessage" },
              {
                id: "steer-1",
                clientId: "steer-1",
                type: "userMessage",
                turnId: "turn-1",
              },
            ],
          },
        ],
      },
    };

    expect(removeItem(history, "steer-1").thread.turns).toEqual([
      {
        id: "turn-1",
        status: "inProgress",
        items: [{ id: "answer-1", type: "agentMessage" }],
      },
    ]);
  });
});

function removeItem(history: ThreadHistoryState, clientId: string) {
  const remove = Reflect.get(historyItems, "removeItemByClientId") as
    | ((history: ThreadHistoryState, clientId: string) => ThreadHistoryState)
    | undefined;
  if (remove === undefined) throw new Error("removeItemByClientId is not implemented");
  return remove(history, clientId);
}
