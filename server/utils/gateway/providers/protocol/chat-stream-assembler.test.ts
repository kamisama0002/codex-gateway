import { describe, expect, it } from "vitest";
import { ChatStreamAssembler } from "./chat-stream-assembler";

describe("ChatStreamAssembler", () => {
  it("reconstructs fragmented tool metadata and JSON arguments", () => {
    const assembler = new ChatStreamAssembler();
    assembler.push({ choiceIndex: 0, toolIndex: 0, toolCall: { id: "call-1", name: "query_", arguments: '{"pro' } });
    assembler.push({ choiceIndex: 0, toolIndex: 0, toolCall: { name: "sales", arguments: 'ject":1}' } });
    const events = assembler.finish();
    expect(events.at(-2)).toMatchObject({ type: "response.output_item.done", item: { type: "function_call", call_id: "call-1", name: "query_sales", arguments: '{"project":1}' } });
    expect(events.at(-1)).toMatchObject({ type: "response.completed", response: { status: "completed" } });
  });

  it("rejects an incomplete JSON tool call", () => {
    const assembler = new ChatStreamAssembler();
    assembler.push({ toolCall: { id: "call-1", name: "query", arguments: "{" } });
    expect(() => assembler.finish()).toThrow(/JSON/);
  });

  it("emits text deltas and completed output", () => {
    const assembler = new ChatStreamAssembler();
    const events = assembler.push({ text: "hello" });
    expect(events.map((event) => event.type)).toContain("response.output_text.delta");
    expect(assembler.finish().map((event) => event.type)).toContain("response.output_text.done");
  });

  it("keeps multiple tool calls from one upstream choice", () => {
    const assembler = new ChatStreamAssembler();
    assembler.push({
      choices: [{
        index: 0,
        delta: {
          tool_calls: [
            { index: 0, id: "a", function: { name: "first", arguments: "{}" } },
            { index: 1, id: "b", function: { name: "second", arguments: "{}" } },
          ],
        },
      }],
    });
    const done = assembler.finish().filter((event) => event.type === "response.output_item.done");
    expect(done).toHaveLength(2);
  });
});
