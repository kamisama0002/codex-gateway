import type { VirtualItem, Virtualizer, VirtualizerOptions } from "@tanstack/virtual-core";

type ChatVirtualizerBehavior = Pick<
  VirtualizerOptions<HTMLElement, Element>,
  "anchorTo" | "followOnAppend" | "scrollEndThreshold"
>;

export function resolveChatFollowLatest(options: {
  currentlyFollowing: boolean;
  distanceFromEnd: number;
  scrollEndThreshold: number;
  scrollingBackward: boolean;
}) {
  if (options.distanceFromEnd <= options.scrollEndThreshold) return true;
  if (options.scrollingBackward) return false;

  // A scroll event from Core's previous end correction can arrive after the next streaming DOM
  // patch. At that instant the new row has already enlarged scrollHeight, but its ResizeObserver
  // has not yet applied the matching correction. Preserve ownership unless an actual backward
  // scroll says the reader moved away; detached readers still reattach only upon reaching the end.
  return options.currentlyFollowing;
}

export function createChatVirtualizerBehavior(options: {
  followLatest: boolean;
  scrollEndThreshold: number;
}): ChatVirtualizerBehavior {
  // This is TanStack Virtual's official Chat contract. Stable keys plus permanent end anchoring
  // let virtual-core preserve prepended history, follow appended rows only when already at the
  // latest content, and keep a streaming final row pinned as its measured height changes.
  //
  // Keep keyed end anchoring enabled for history prepends, but disable end-follow decisions once
  // native viewport geometry says the reader detached. Direct-DOM size commits can briefly make
  // virtual distance look like zero while the real viewport is above the end; a negative-infinity
  // threshold prevents that transient from turning a row remeasure into a reverse scroll write.
  //
  // This config belongs only to the unbounded outer Agent timeline. Bounded diff and command
  // outputs own separate inner scrollports and must never drive this virtualizer.
  return {
    anchorTo: "end",
    followOnAppend: options.followLatest,
    scrollEndThreshold: options.followLatest
      ? options.scrollEndThreshold
      : Number.NEGATIVE_INFINITY,
  };
}

export function shouldAdjustChatScrollForSizeChange(
  item: VirtualItem,
  instance: Virtualizer<HTMLElement, Element>,
  followLatest: boolean,
  backwardWheelActive: boolean,
) {
  // A newly mounted overscan row can replace its estimate while the user is actively moving
  // upward. Core's default first-measurement compensation then writes a positive scroll delta and
  // partially undoes that gesture. Keep all measurement and layout work in Core, but let backward
  // wheel input own the offset until its normal scroll-end boundary. Touch keeps Core's normal
  // compensation (and its iOS deferral) so the finger-up anchor can settle correctly.
  if (
    !followLatest &&
    backwardWheelActive &&
    instance.isScrolling &&
    instance.scrollDirection === "backward"
  ) {
    return false;
  }

  const scrollOffset =
    (instance.scrollElement instanceof HTMLElement
      ? instance.scrollElement.scrollTop
      : (instance.scrollOffset ?? 0)) + instance.scrollAdjustments;
  const firstMeasurement = !instance.itemSizeCache.has(item.key);
  return firstMeasurement
    ? item.start < scrollOffset
    : item.end <= scrollOffset && instance.scrollDirection !== "backward";
}
