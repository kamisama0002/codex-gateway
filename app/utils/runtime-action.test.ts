import { describe, expect, it } from "vitest";
import { isRuntimeActionPending, runtimeActionForStatus } from "./runtime-action";

describe("runtimeActionForStatus", () => {
  it.each([
    [undefined, "start"],
    [null, "start"],
    ["absent", "start"],
    ["degraded", "start"],
    ["incompatible", "start"],
    ["ready", "restart"],
    ["provisioning", "pending"],
    ["starting", "pending"],
    ["schema_checking", "pending"],
    ["syncing_capabilities", "pending"],
    ["restarting", "pending"],
  ] as const)("maps %s to %s", (status, expected) => {
    expect(runtimeActionForStatus(status)).toBe(expected);
  });

  it("identifies transitional states without treating failures as pending", () => {
    expect(isRuntimeActionPending("provisioning")).toBe(true);
    expect(isRuntimeActionPending("degraded")).toBe(false);
  });
});
