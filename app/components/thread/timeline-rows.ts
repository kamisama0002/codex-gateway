import type { ThreadResponseUsage, ThreadTimelineItem, ThreadTimelineTurn } from "~~/shared/types";
import type { DisplayedTurnTiming } from "@/utils/turn-timing";
import { threadItemText } from "@/utils/thread-items";
import { itemKey, userMessageVariant, type ThreadTurnSections } from "./thread-turn-sections";

export type { ThreadTimelineTurn } from "~~/shared/types";

type ThreadTimelineItemSection = "user" | "intermediate" | "final";

const estimatedItemHeights: Partial<Record<ThreadTimelineItem["type"], number>> = {
  commandExecution: 48,
  fileChange: 440,
  agentMessage: 144,
  reasoning: 128,
  userMessage: 160,
};

export interface ThreadTurnNavigation {
  turnId: string;
  prompt: string;
  response: string;
  active: boolean;
}

export type ThreadTimelineRow = (
  | {
      key: string;
      type: "intermediateHeader";
      turnId: string;
      count: number;
      toolCallCount: number;
      messageCount: number;
      subagentCount: number;
      open: boolean;
      loading: boolean;
      loaded: boolean;
      active: boolean;
    }
  | {
      key: string;
      type: "item";
      turnId: string;
      section: ThreadTimelineItemSection;
      item: ThreadTimelineItem;
      userMessageVariant: "normal" | "steer";
      turnTiming: DisplayedTurnTiming | null;
      responseUsage: ThreadResponseUsage[] | undefined;
      agentActionsAvailable: boolean;
    }
  | {
      key: string;
      type: "turnDuration";
      turnId: string;
      startedAt: number | null;
      completedAt: number | null;
      durationMs: number | null;
      active: boolean;
      responseUsage: ThreadResponseUsage[] | undefined;
    }
) & {
  turnNavigation?: ThreadTurnNavigation;
};

export interface ThreadTimelineTurnState {
  turn: ThreadTimelineTurn;
  sections: ThreadTurnSections;
  intermediateOpen: boolean;
  intermediateLoading: boolean;
}

// Every visible entry is a direct row of the Agent timeline. Do not wrap intermediate items in a
// second virtualizer: two height caches sharing one scroll element can leave stale blank space on
// WebKit. Collapsing is represented only by omitting intermediate item rows from this flat model.
export function buildThreadTimelineRows(input: {
  threadId: string | null;
  turns: ThreadTimelineTurnState[];
  agentActionsAvailable: boolean;
}) {
  return input.turns.flatMap(({ turn, sections, intermediateOpen, intermediateLoading }) => {
    const rows: ThreadTimelineRow[] = [];
    const timing = displayedTurnTiming(turn);
    const timingTarget = sections.finalItems.findLast((item) => item.type === "agentMessage");
    appendItemRows(rows, input.threadId, turn.id, "user", sections.userItems, sections);

    // Match DSH's foldable-process rule: incomplete history is not evidence that a process exists.
    // Visible summary Turns are hydrated in the background; only real process items add this row.
    if (sections.intermediateItems.length > 0) {
      const summary = intermediateProcessSummary(sections.intermediateItems);
      rows.push({
        key: `${input.threadId}:turn-${turn.id}:intermediate-header`,
        type: "intermediateHeader",
        turnId: turn.id,
        count: sections.intermediateItems.length,
        ...summary,
        open: intermediateOpen,
        loading: intermediateLoading,
        loaded: turn.itemsView === "full",
        active: sections.turnIsActive,
      });
      if (intermediateOpen) {
        appendItemRows(
          rows,
          input.threadId,
          turn.id,
          "intermediate",
          sections.intermediateItems,
          sections,
        );
      }
    }

    appendItemRows(
      rows,
      input.threadId,
      turn.id,
      "final",
      sections.finalItems,
      sections,
      timingTarget,
      timing,
      input.agentActionsAvailable,
      turn.responseUsage,
    );
    // Completed turns normally render timing beside the final answer's copy action. Keep a
    // standalone row only for interrupted/error turns that never produced an Agent answer.
    if (
      input.agentActionsAvailable &&
      (hasTimingValue(timing) || (turn.responseUsage?.length ?? 0) > 0) &&
      timingTarget === undefined
    ) {
      rows.push({
        key: `${input.threadId}:turn-${turn.id}:duration`,
        type: "turnDuration",
        turnId: turn.id,
        ...timing,
        responseUsage: turn.responseUsage,
      });
    }
    const firstRow = rows[0];
    if (firstRow !== undefined) {
      firstRow.turnNavigation = turnNavigation(turn, sections);
    }
    return rows;
  });
}

export function reuseUnchangedTimelineRows(
  previous: ThreadTimelineRow[] | undefined,
  next: ThreadTimelineRow[],
) {
  if (previous === undefined || previous.length === 0) return next;
  const previousByKey = new Map(previous.map((row) => [row.key, row]));
  return next.map((row) => {
    const candidate = previousByKey.get(row.key);
    return candidate !== undefined && sameTimelineRow(candidate, row) ? candidate : row;
  });
}

export function estimateThreadTimelineRow(row: ThreadTimelineRow | undefined) {
  if (row === undefined) return 96;
  if (row.type === "intermediateHeader") return 48;
  if (row.type === "turnDuration") return 28;
  return estimatedItemHeights[row.item.type] ?? 96;
}

function appendItemRows(
  rows: ThreadTimelineRow[],
  threadId: string | null,
  turnId: string,
  section: ThreadTimelineItemSection,
  items: ThreadTimelineItem[],
  sections: ThreadTurnSections,
  timingTarget?: ThreadTimelineItem,
  timing: DisplayedTurnTiming | null = null,
  agentActionsAvailable = false,
  responseUsage?: ThreadResponseUsage[],
) {
  items.forEach((item, index) => {
    rows.push({
      key: `${threadId}:turn-${turnId}:${section}:${itemKey(item, section, index)}`,
      type: "item",
      turnId,
      section,
      item,
      userMessageVariant: userMessageVariant(item, sections),
      turnTiming: item === timingTarget ? timing : null,
      responseUsage: item === timingTarget ? responseUsage : undefined,
      agentActionsAvailable: item === timingTarget && agentActionsAvailable,
    });
  });
}

function displayedTurnTiming(turn: ThreadTimelineTurn): DisplayedTurnTiming {
  return {
    startedAt: typeof turn.startedAt === "number" ? turn.startedAt : null,
    completedAt: typeof turn.completedAt === "number" ? turn.completedAt : null,
    durationMs: turn.durationMs ?? null,
    active: turn.status === "inProgress",
  };
}

function hasTimingValue(timing: DisplayedTurnTiming) {
  return timing.startedAt !== null || timing.durationMs !== null;
}

function turnNavigation(turn: ThreadTimelineTurn, sections: ThreadTurnSections) {
  const promptItem = sections.userItems.find((item) => item.type === "userMessage");
  const responseItem =
    sections.finalItems.findLast((item) => item.type === "agentMessage") ??
    sections.intermediateItems.findLast((item) => item.type === "agentMessage");
  return {
    turnId: turn.id,
    prompt: promptItem === undefined ? "" : threadItemText(promptItem),
    response: responseItem === undefined ? "" : threadItemText(responseItem),
    active: sections.turnIsActive,
  };
}

function sameTimelineRow(left: ThreadTimelineRow, right: ThreadTimelineRow) {
  if (left.type !== right.type) return false;
  if (left.type === "intermediateHeader" && right.type === "intermediateHeader") {
    return (
      left.count === right.count &&
      left.toolCallCount === right.toolCallCount &&
      left.messageCount === right.messageCount &&
      left.subagentCount === right.subagentCount &&
      left.open === right.open &&
      left.loading === right.loading &&
      left.loaded === right.loaded &&
      left.active === right.active &&
      left.turnId === right.turnId &&
      sameTurnNavigation(left.turnNavigation, right.turnNavigation)
    );
  }
  if (left.type === "item" && right.type === "item") {
    // App-server deltas mutate this reactive item proxy in place. Reuse the lightweight row wrapper
    // so unrelated mounted Markdown rows do not rerender, but never clone or mark the item raw:
    // nested text/output reactivity is the official Vue update path that feeds TanStack's row
    // ResizeObserver. A separate presentation revision would duplicate timeline state.
    return (
      left.item === right.item &&
      left.turnId === right.turnId &&
      left.section === right.section &&
      left.userMessageVariant === right.userMessageVariant &&
      left.agentActionsAvailable === right.agentActionsAvailable &&
      sameTurnNavigation(left.turnNavigation, right.turnNavigation) &&
      sameResponseUsage(left.responseUsage, right.responseUsage) &&
      sameTurnTiming(left.turnTiming, right.turnTiming)
    );
  }
  if (left.type === "turnDuration" && right.type === "turnDuration") {
    return (
      left.turnId === right.turnId &&
      left.startedAt === right.startedAt &&
      left.completedAt === right.completedAt &&
      left.durationMs === right.durationMs &&
      left.active === right.active &&
      sameTurnNavigation(left.turnNavigation, right.turnNavigation) &&
      sameResponseUsage(left.responseUsage, right.responseUsage)
    );
  }
  return false;
}

function sameTurnNavigation(
  left: ThreadTurnNavigation | undefined,
  right: ThreadTurnNavigation | undefined,
) {
  if (left === undefined || right === undefined) return left === right;
  return (
    left.turnId === right.turnId &&
    left.prompt === right.prompt &&
    left.response === right.response &&
    left.active === right.active
  );
}

const intermediateToolItemTypes = new Set<ThreadTimelineItem["type"]>([
  "attestationRequest",
  "chatgptAuthTokensRefreshRequest",
  "commandExecution",
  "contextCompaction",
  "dynamicToolClientRequest",
  "dynamicToolCall",
  "enteredReviewMode",
  "exitedReviewMode",
  "fileChange",
  "hookPrompt",
  "imageGeneration",
  "imageView",
  "mcpElicitationRequest",
  "mcpToolCall",
  "permissionsRequest",
  "requestUserInput",
  "serverRequest",
  "sleep",
  "webSearch",
]);

export function intermediateProcessSummary(items: ThreadTimelineItem[]) {
  return items.reduce(
    (summary, item) => {
      if (intermediateToolItemTypes.has(item.type)) summary.toolCallCount += 1;
      if (item.type === "agentMessage" || item.type === "reasoning") summary.messageCount += 1;
      if (item.type === "collabAgentToolCall" || item.type === "subAgentActivity") {
        summary.subagentCount += 1;
      }
      return summary;
    },
    { toolCallCount: 0, messageCount: 0, subagentCount: 0 },
  );
}

function sameResponseUsage(
  left: ThreadResponseUsage[] | undefined,
  right: ThreadResponseUsage[] | undefined,
) {
  if (left === right) return true;
  if (left === undefined || right === undefined || left.length !== right.length) return false;
  return left.every(
    (usage, index) =>
      usage.responseId === right[index]?.responseId && usage.amount === right[index]?.amount,
  );
}

function sameTurnTiming(left: DisplayedTurnTiming | null, right: DisplayedTurnTiming | null) {
  if (left === null || right === null) return left === right;
  return (
    left.startedAt === right.startedAt &&
    left.completedAt === right.completedAt &&
    left.durationMs === right.durationMs &&
    left.active === right.active
  );
}
