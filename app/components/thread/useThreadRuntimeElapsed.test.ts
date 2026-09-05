import { effectScope, nextTick, ref } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ThreadRuntimePhase } from "~~/shared/types";
import { useThreadRuntimeElapsed } from "./useThreadRuntimeElapsed";

describe("useThreadRuntimeElapsed", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("increments once per second for an active phase", () => {
    vi.useFakeTimers();
    const threadId = ref("thread-a");
    const phase = ref<ThreadRuntimePhase>("running");
    const scope = effectScope();
    const elapsed = scope.run(() => useThreadRuntimeElapsed(threadId, phase));

    expect(elapsed?.value).toBe(0);
    vi.advanceTimersByTime(1_000);
    expect(elapsed?.value).toBe(1);

    scope.stop();
  });

  it("catches up from wall-clock time when several seconds pass before one timer callback", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-05T00:00:00.000Z"));
    const interval = vi.spyOn(globalThis, "setInterval");
    const threadId = ref("thread-a");
    const phase = ref<ThreadRuntimePhase>("running");
    const scope = effectScope();
    const elapsed = scope.run(() => useThreadRuntimeElapsed(threadId, phase));
    const tick = interval.mock.calls[0]?.[0];
    if (typeof tick !== "function") throw new Error("Elapsed interval callback was not installed");

    vi.setSystemTime(new Date("2026-09-05T00:00:05.500Z"));
    tick();

    expect(elapsed?.value).toBe(5);
    scope.stop();
  });

  it("resets when the phase changes", async () => {
    vi.useFakeTimers();
    const threadId = ref("thread-a");
    const phase = ref<ThreadRuntimePhase>("running");
    const scope = effectScope();
    const elapsed = scope.run(() => useThreadRuntimeElapsed(threadId, phase));

    vi.advanceTimersByTime(1_000);
    phase.value = "waitingForInput";
    await nextTick();
    expect(elapsed?.value).toBe(0);

    scope.stop();
  });

  it("resets when the thread changes", async () => {
    vi.useFakeTimers();
    const threadId = ref("thread-a");
    const phase = ref<ThreadRuntimePhase>("running");
    const scope = effectScope();
    const elapsed = scope.run(() => useThreadRuntimeElapsed(threadId, phase));

    vi.advanceTimersByTime(1_000);
    threadId.value = "thread-b";
    await nextTick();
    expect(elapsed?.value).toBe(0);

    scope.stop();
  });

  it("stops incrementing when its scope is disposed", () => {
    vi.useFakeTimers();
    const threadId = ref("thread-a");
    const phase = ref<ThreadRuntimePhase>("running");
    const scope = effectScope();
    const elapsed = scope.run(() => useThreadRuntimeElapsed(threadId, phase));

    vi.advanceTimersByTime(1_000);
    scope.stop();
    vi.advanceTimersByTime(1_000);
    expect(elapsed?.value).toBe(1);
  });
});
