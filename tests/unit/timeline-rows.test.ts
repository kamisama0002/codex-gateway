import { describe, expect, it } from "vitest";
import { intermediateProcessSummary } from "../../app/components/thread/timeline-rows";
import type { ThreadTimelineItem } from "../../shared/types";

describe("intermediate process summary", () => {
  it("separates tool calls, process messages, and subagents", () => {
    const items = [
      { type: "reasoning" },
      { type: "agentMessage" },
      { type: "commandExecution" },
      { type: "mcpToolCall" },
      { type: "collabAgentToolCall" },
      { type: "subAgentActivity" },
      { type: "plan" },
    ] as ThreadTimelineItem[];

    expect(intermediateProcessSummary(items)).toEqual({
      toolCallCount: 2,
      messageCount: 2,
      subagentCount: 2,
    });
  });
});
