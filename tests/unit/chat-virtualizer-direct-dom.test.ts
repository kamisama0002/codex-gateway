import { describe, expect, it } from "vitest";
import { didVirtualIndexMembershipChange } from "../../app/components/common/chat-virtualizer/direct-dom-virtualizer";

describe("chat direct DOM virtualizer", () => {
  it("detects forced virtual index cleanup without a range-boundary change", () => {
    expect(didVirtualIndexMembershipChange([0, 1, 5], [1, 5])).toBe(true);
    expect(didVirtualIndexMembershipChange([1, 5], [1, 5])).toBe(false);
  });
});
