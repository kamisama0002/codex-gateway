import { describe, expect, it } from "vitest";
import {
  buildThreadTimelineRows,
  intermediateProcessSummary,
  type ThreadTimelineTurnState,
} from "../../app/components/thread/timeline-rows";
import { buildThreadTurnSections } from "../../app/components/thread/thread-turn-sections";
import type { ThreadTimelineItem, ThreadTimelineTurn } from "../../shared/types";

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

  it("does not render a disclosure for an unloaded summary with no known process items", () => {
    const summaryOnly = turnState({
      id: "turn-summary-only",
      status: "completed",
      itemsView: "summary",
      prompt: "1等于几",
      response: "1",
    });

    const rows = buildThreadTimelineRows({
      threadId: "thread-1",
      turns: [summaryOnly],
      agentActionsAvailable: true,
    });

    expect(rows.some((row) => row.type === "intermediateHeader")).toBe(false);
  });

  it("keeps the disclosure when a summary already proves process content exists", () => {
    const summaryWithProcess = turnState({
      id: "turn-summary-process",
      status: "completed",
      itemsView: "summary",
      prompt: "查看营业额",
      intermediateResponse: "正在查询业务数据",
      response: "营业额为 100 万元",
    });

    const rows = buildThreadTimelineRows({
      threadId: "thread-1",
      turns: [summaryWithProcess],
      agentActionsAvailable: true,
    });

    expect(rows.some((row) => row.type === "intermediateHeader")).toBe(true);
  });
});

describe("reasoning visibility", () => {
  it("omits blank reasoning from timeline rows and intermediate counts", () => {
    const turn = reasoningTurn(["  "], ["\n"]);
    const sections = buildThreadTurnSections(turn, { planModeActive: false });
    const rows = buildThreadTimelineRows({
      threadId: "thread-1",
      turns: [
        {
          turn,
          sections,
          intermediateOpen: true,
          intermediateLoading: false,
        },
      ],
      agentActionsAvailable: true,
    });

    expect(sections.items).toEqual([turn.items[0], turn.items[2]]);
    expect(sections.intermediateItems).toEqual([]);
    expect(rows.some((row) => row.type === "intermediateHeader")).toBe(false);
  });

  it("reveals the same reasoning item when its first visible text arrives", () => {
    const turn = reasoningTurn([], []);
    const reasoning = turn.items[1];
    if (reasoning?.type !== "reasoning") throw new Error("Reasoning fixture is missing");

    expect(buildThreadTurnSections(turn, { planModeActive: false }).intermediateItems).toEqual([]);

    reasoning.summary = ["正在检查营业额口径"];
    const sections = buildThreadTurnSections(turn, { planModeActive: false });

    expect(sections.intermediateItems).toEqual([reasoning]);
    expect(intermediateProcessSummary(sections.intermediateItems)).toEqual({
      toolCallCount: 0,
      messageCount: 1,
      subagentCount: 0,
    });
  });
});

describe("turn navigation metadata", () => {
  it("attaches one prompt and response preview to the first visible row of every turn", () => {
    const first = turnState({
      id: "turn-1",
      status: "completed",
      prompt: "分析本月营业额",
      intermediateResponse: "正在汇总门店数据",
      response: "营业额环比增长 12%",
    });
    const second = turnState({
      id: "turn-2",
      status: "inProgress",
      prompt: "继续分析异常门店",
      response: "正在检查门店明细",
    });

    const rows = buildThreadTimelineRows({
      threadId: "thread-1",
      turns: [first, second],
      agentActionsAvailable: false,
    });
    const navigation = rows.flatMap((row) =>
      row.turnNavigation === undefined ? [] : [row.turnNavigation],
    );

    expect(navigation).toEqual([
      {
        turnId: "turn-1",
        prompt: "分析本月营业额",
        response: "营业额环比增长 12%",
        active: false,
      },
      {
        turnId: "turn-2",
        prompt: "继续分析异常门店",
        response: "正在检查门店明细",
        active: true,
      },
    ]);
  });
});

function turnState(input: {
  id: string;
  status: string;
  itemsView?: "notLoaded" | "summary" | "full";
  prompt: string;
  intermediateResponse?: string;
  response: string;
}): ThreadTimelineTurnState {
  const userItem: ThreadTimelineItem = {
    id: `${input.id}-user`,
    type: "userMessage",
    content: [{ type: "text", text: input.prompt }],
  };
  const agentItem: ThreadTimelineItem = {
    id: `${input.id}-agent`,
    type: "agentMessage",
    phase: "final_answer",
    status: input.status,
    text: input.response,
  };
  const intermediateItem: ThreadTimelineItem | undefined =
    input.intermediateResponse !== undefined && input.intermediateResponse !== ""
      ? {
          id: `${input.id}-intermediate`,
          type: "agentMessage",
          phase: "commentary",
          status: "completed",
          text: input.intermediateResponse,
        }
      : undefined;
  const intermediateItems = intermediateItem === undefined ? [] : [intermediateItem];
  const turn: ThreadTimelineTurn = {
    id: input.id,
    status: input.status,
    itemsView: input.itemsView ?? "full",
    items: [userItem, ...intermediateItems, agentItem],
  };
  return {
    turn,
    sections: {
      items: turn.items,
      userItems: [userItem],
      intermediateItems,
      finalItems: [agentItem],
      finalAgentIndex: turn.items.length - 1,
      firstIntermediateIndex: 1,
      hasFinalAnswer: true,
      turnIsActive: input.status === "inProgress",
    },
    intermediateOpen: false,
    intermediateLoading: false,
  };
}

function reasoningTurn(summary: unknown[], content: unknown[]): ThreadTimelineTurn {
  return {
    id: "turn-reasoning",
    status: "completed",
    itemsView: "full",
    items: [
      {
        id: "user-reasoning",
        type: "userMessage",
        content: [{ type: "text", text: "分析营业额" }],
      },
      {
        id: "reasoning-blank",
        type: "reasoning",
        status: "completed",
        summary,
        content,
      },
      {
        id: "agent-reasoning",
        type: "agentMessage",
        phase: "final_answer",
        status: "completed",
        text: "分析完成",
      },
    ],
  };
}
