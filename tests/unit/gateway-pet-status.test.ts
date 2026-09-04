import { describe, expect, it } from "vitest";
import type { ThreadTimelineItem } from "../../shared/types";
import { gatewayPetStatus } from "../../app/stores/gateway-pet/status";

describe("gatewayPetStatus", () => {
  it.each([
    ["idle", "idle"],
    ["running", "running"],
    ["completed", "ready"],
    ["interrupted", "ready"],
    ["failed", "failed"],
  ] as const)("maps %s runtime status to %s", (runtimeStatus, expected) => {
    expect(gatewayPetStatus({ hasThread: true, runtimeStatus, items: [] })).toBe(expected);
  });

  it("prioritizes a pending user request over the running status", () => {
    const item = {
      type: "requestUserInput",
      status: "inProgress",
      requestId: "request-1",
    } satisfies ThreadTimelineItem;
    expect(gatewayPetStatus({ hasThread: true, runtimeStatus: "running", items: [item] })).toBe(
      "waiting",
    );
  });

  it("ignores a resolved request", () => {
    const item = {
      type: "requestUserInput",
      status: "completed",
    } satisfies ThreadTimelineItem;
    expect(gatewayPetStatus({ hasThread: true, runtimeStatus: "completed", items: [item] })).toBe(
      "ready",
    );
  });
});
