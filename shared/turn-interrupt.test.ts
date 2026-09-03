import { describe, expect, it } from "vitest";
import {
  currentActiveTurnIdFromInterruptError,
  isNoActiveTurnToInterruptError,
} from "./turn-interrupt";

describe("turn interrupt errors", () => {
  it("treats no-active-turn as already stopped", () => {
    expect(isNoActiveTurnToInterruptError(new Error("no active turn to interrupt"))).toBe(true);
    expect(
      isNoActiveTurnToInterruptError(
        new Error("Realtime message failed\nno active turn to interrupt"),
      ),
    ).toBe(true);
    expect(isNoActiveTurnToInterruptError(new Error("failed to interrupt turn"))).toBe(false);
  });

  it("reads the current active turn id from a stale interrupt error", () => {
    expect(
      currentActiveTurnIdFromInterruptError(
        new Error(
          "expected active turn id 01a0602c-35c8-7a01-af1b-cd4a7175a240 but found 01a06031-c50e-7fe3-8847-a594307a0787",
        ),
      ),
    ).toBe("01a06031-c50e-7fe3-8847-a594307a0787");
    expect(currentActiveTurnIdFromInterruptError(new Error("no active turn to interrupt"))).toBe(
      null,
    );
  });
});
