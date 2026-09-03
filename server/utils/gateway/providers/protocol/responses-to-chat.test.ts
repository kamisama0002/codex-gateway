import { describe, expect, it } from "vitest";
import { toChatCompletionRequest } from "./responses-to-chat";

const capabilities = { tools: true, streamingTools: true, vision: false, reasoning: true, maxContextTokens: null };

describe("toChatCompletionRequest", () => {
  it("maps instructions, messages, function calls, and tool outputs", () => {
    const result = toChatCompletionRequest(
      {
        model: "deepseek-v4",
        instructions: "Be concise",
        input: [
          { type: "message", role: "user", content: [{ type: "input_text", text: "What is sales?" }] },
          { type: "function_call", call_id: "call-1", name: "query_sales", arguments: '{"project":1}' },
          { type: "function_call_output", call_id: "call-1", output: "42" },
        ],
        tools: [{ type: "function", name: "query_sales", parameters: { type: "object" } }],
      },
      capabilities,
    );
    expect(result.messages).toEqual([
      { role: "system", content: "Be concise" },
      { role: "user", content: "What is sales?" },
      {
        role: "assistant",
        content: null,
        tool_calls: [{ id: "call-1", type: "function", function: { name: "query_sales", arguments: '{"project":1}' } }],
      },
      { role: "tool", tool_call_id: "call-1", content: "42" },
    ]);
  });

  it("rejects unsupported tool semantics before producing a request", () => {
    expect(() => toChatCompletionRequest({ model: "m", tools: [{ type: "computer_use" }] }, capabilities)).toThrow(
      /computer_use/,
    );
  });
});
