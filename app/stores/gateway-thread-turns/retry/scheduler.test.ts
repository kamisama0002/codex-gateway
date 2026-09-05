import { afterEach, describe, expect, it, vi } from "vitest";
import { waitForRetry } from "./scheduler";

describe("turn retry scheduling", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("ends the retry delay immediately when the submission is cancelled", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const pending = waitForRetry(5, controller.signal).then(
      () => "resolved",
      () => "cancelled",
    );

    controller.abort(new Error("Submission cancelled"));
    await Promise.resolve();

    expect(await Promise.race([pending, Promise.resolve("still waiting")])).toBe("cancelled");
    expect(vi.getTimerCount()).toBe(0);
  });
});
