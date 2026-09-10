import { describe, expect, it } from "vitest";
import {
  DEFAULT_RUNTIME_IDLE_TIMEOUT_MINUTES,
  runtimeIdleTimeoutMinutes,
  runtimeIdleTimeoutMs,
} from "./runtime-idle-timeout";

describe("runtime idle timeout", () => {
  it("defaults to zero (no automatic idle release)", () => {
    expect(runtimeIdleTimeoutMinutes({})).toBe(DEFAULT_RUNTIME_IDLE_TIMEOUT_MINUTES);
    expect(runtimeIdleTimeoutMs({})).toBe(0);
  });

  it("accepts zero to disable automatic release", () => {
    expect(runtimeIdleTimeoutMinutes({ RUNTIME_IDLE_TIMEOUT_MINUTES: "0" })).toBe(0);
    expect(runtimeIdleTimeoutMs({ RUNTIME_IDLE_TIMEOUT_MINUTES: "0" })).toBe(0);
  });

  it("rejects negative and fractional values", () => {
    expect(() => runtimeIdleTimeoutMs({ RUNTIME_IDLE_TIMEOUT_MINUTES: "-1" })).toThrow();
    expect(() => runtimeIdleTimeoutMs({ RUNTIME_IDLE_TIMEOUT_MINUTES: "1.5" })).toThrow();
  });
});
