import { describe, expect, it } from "vitest";
import {
  resolveBackwardWheelOwnership,
  resolveChatFollowLatest,
} from "../../app/components/common/chat-virtualizer/anchoring";

describe("chat virtualizer anchoring", () => {
  it("releases backward wheel ownership at the hard start edge", () => {
    expect(resolveBackwardWheelOwnership({ deltaY: -120, scrollTop: 40 })).toBe(true);
    expect(resolveBackwardWheelOwnership({ deltaY: -120, scrollTop: 0 })).toBe(false);
    expect(resolveBackwardWheelOwnership({ deltaY: 120, scrollTop: 40 })).toBe(false);
  });

  it("preserves following across a delayed forward scroll event during streaming growth", () => {
    expect(
      resolveChatFollowLatest({
        currentlyFollowing: true,
        distanceFromEnd: 288,
        scrollEndThreshold: 2,
        scrollingBackward: false,
      }),
    ).toBe(true);
  });

  it("detaches on backward input and reattaches only at the latest edge", () => {
    expect(
      resolveChatFollowLatest({
        currentlyFollowing: true,
        distanceFromEnd: 48,
        scrollEndThreshold: 2,
        scrollingBackward: true,
      }),
    ).toBe(false);
    expect(
      resolveChatFollowLatest({
        currentlyFollowing: false,
        distanceFromEnd: 24,
        scrollEndThreshold: 2,
        scrollingBackward: false,
      }),
    ).toBe(false);
    expect(
      resolveChatFollowLatest({
        currentlyFollowing: false,
        distanceFromEnd: 2,
        scrollEndThreshold: 2,
        scrollingBackward: false,
      }),
    ).toBe(true);
  });
});
