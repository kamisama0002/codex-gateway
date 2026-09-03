import { describe, expect, it } from "vitest";
import { toResponsesResult } from "./chat-to-responses";

describe("toResponsesResult", () => {
  it("maps assistant text, function calls, and usage", () => {
    const result = toResponsesResult(
      {
        id: "chat-1",
        model: "m",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: "I will query that.",
              tool_calls: [
                { id: "call-1", type: "function", function: { name: "query_sales", arguments: '{"x":1}' } },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      },
      "m",
    );
    expect(result.output_text).toBe("I will query that.");
    expect(result.output).toContainEqual(expect.objectContaining({ type: "function_call", call_id: "call-1" }));
    expect(result.usage).toEqual({ input_tokens: 10, output_tokens: 5, total_tokens: 15 });
    expect(result.status).toBe("completed");
  });

  it("does not expose malformed tool arguments as executable calls", () => {
    const result = toResponsesResult(
      { choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: "x", type: "function", function: { name: "bad", arguments: "{" } }] } }] },
      "m",
    );
    expect(result.output).toEqual([]);
    expect(result.status).toBe("failed");
  });
});
