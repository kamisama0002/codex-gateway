import { effectScope, nextTick, ref } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ThreadRuntimePhase } from "~~/shared/types";
import { useThreadRuntimeElapsed } from "./useThreadRuntimeElapsed";

describe("useThreadRuntimeElapsed", () => {
  afterEach(() => {
    vi.useRealTimers();
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
