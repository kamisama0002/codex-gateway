import type { ThreadHistoryItem, ThreadHistoryTurn } from "~~/shared/types";

type MessageClockTranslate = (key: string, params: Record<string, number>) => string;

export function normalizedTimestampMs(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.abs(value) < 100_000_000_000 ? value * 1000 : value;
  }
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function messageTimestampMs(item: ThreadHistoryItem, turn: ThreadHistoryTurn) {
  const candidates =
    item.type === "userMessage"
      ? [item.startedAt, item.completedAt, item.createdAt, turn.startedAt]
      : item.type === "agentMessage"
        ? [item.completedAt, item.startedAt, item.createdAt, turn.completedAt]
        : [];
  for (const candidate of candidates) {
    const timestamp = normalizedTimestampMs(candidate);
    if (timestamp !== null) return timestamp;
  }
  return null;
}

export function formatMessageClock(
  timeMs: number,
  t: MessageClockTranslate,
  nowMs: number = Date.now(),
) {
  const time = new Date(timeMs);
  const now = new Date(nowMs);
  const clock = `${pad2(time.getHours())}:${pad2(time.getMinutes())}`;
  if (
    time.getFullYear() === now.getFullYear() &&
    time.getMonth() === now.getMonth() &&
    time.getDate() === now.getDate()
  ) {
    return clock;
  }
  const params = {
    year: time.getFullYear(),
    month: time.getMonth() + 1,
    day: time.getDate(),
  };
  const date =
    time.getFullYear() === now.getFullYear()
      ? t("app.messageClockMonthDay", params)
      : t("app.messageClockYearMonthDay", params);
  return `${date} ${clock}`;
}

function pad2(value: number) {
  return String(value).padStart(2, "0");
}
