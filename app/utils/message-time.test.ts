import { describe, expect, it } from "vitest";
import { formatMessageClock, messageTimestampMs } from "./message-time";

describe("message timestamps", () => {
  it("prefers the user start and assistant completion lifecycle timestamps", () => {
    const turn = { startedAt: 1_782_986_400, completedAt: 1_782_986_402.5 };

    expect(
      messageTimestampMs(
        { type: "userMessage", startedAt: 1_782_986_400_125, completedAt: 1_782_986_400_250 },
        turn,
      ),
    ).toBe(1_782_986_400_125);
    expect(
      messageTimestampMs(
        { type: "agentMessage", startedAt: 1_782_986_401_000, completedAt: 1_782_986_402_250 },
        turn,
      ),
    ).toBe(1_782_986_402_250);
  });

  it("falls back to second-based turn boundaries when item timestamps are absent", () => {
    const turn = { startedAt: 1_782_986_400, completedAt: 1_782_986_402.5 };

    expect(messageTimestampMs({ type: "userMessage" }, turn)).toBe(1_782_986_400_000);
    expect(messageTimestampMs({ type: "agentMessage" }, turn)).toBe(1_782_986_402_500);
    expect(messageTimestampMs({ type: "reasoning" }, turn)).toBeNull();
  });

  it("does not fabricate an assistant message time from an unfinished Turn start", () => {
    expect(
      messageTimestampMs({ type: "agentMessage" }, { startedAt: 1_782_986_400, completedAt: null }),
    ).toBeNull();
  });

  it("formats same-day, same-year and older clocks like DSH", () => {
    const t = (key: string, params: Record<string, number>) => {
      if (key === "app.messageClockMonthDay") return `${params.month}月${params.day}日`;
      return `${params.year}年${params.month}月${params.day}日`;
    };
    const now = new Date(2026, 8, 6, 12, 0).getTime();

    expect(formatMessageClock(new Date(2026, 8, 6, 9, 5).getTime(), t, now)).toBe("09:05");
    expect(formatMessageClock(new Date(2026, 6, 2, 10, 3).getTime(), t, now)).toBe("7月2日 10:03");
    expect(formatMessageClock(new Date(2025, 11, 31, 23, 59).getTime(), t, now)).toBe(
      "2025年12月31日 23:59",
    );
  });
});
