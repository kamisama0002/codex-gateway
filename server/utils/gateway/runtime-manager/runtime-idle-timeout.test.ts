import { describe, expect, it } from "vitest";
import { DEFAULT_RUNTIME_IDLE_TIMEOUT_MINUTES, runtimeIdleTimeoutMs } from "./runtime-idle-timeout";

describe("runtime idle timeout", () => {
  it("defaults to thirty minutes", () => {
    expect(runtimeIdleTimeoutMs({})).toBe(DEFAULT_RUNTIME_IDLE_TIMEOUT_MINUTES * 60_000);
  });

  it("accepts zero to disable automatic release", () => {
    expect(runtimeIdleTimeoutMs({ RUNTIME_IDLE_TIMEOUT_MINUTES: "0" })).toBe(0);
  });

  it("rejects negative and fractional values", () => {
    expect(() => runtimeIdleTimeoutMs({ RUNTIME_IDLE_TIMEOUT_MINUTES: "-1" })).toThrow();
    expect(() => runtimeIdleTimeoutMs({ RUNTIME_IDLE_TIMEOUT_MINUTES: "1.5" })).toThrow();
  });
});
