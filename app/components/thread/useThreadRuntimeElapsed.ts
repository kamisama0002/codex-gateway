import { onScopeDispose, ref, watch, type Ref } from "vue";
import type { ThreadRuntimePhase } from "~~/shared/types";
import { isActiveThreadRuntimePhase } from "~~/shared/thread-runtime-status";

export function useThreadRuntimeElapsed(
  threadId: Readonly<Ref<string | null>>,
  phase: Readonly<Ref<ThreadRuntimePhase>>,
) {
  const elapsedSeconds = ref(0);
  let elapsedTimer: ReturnType<typeof setInterval> | null = null;
  let activeStartedAt: number | null = null;

  function clearElapsedTimer() {
    if (elapsedTimer !== null) clearInterval(elapsedTimer);
    elapsedTimer = null;
    activeStartedAt = null;
  }

  watch(
    [threadId, phase],
    ([nextThreadId, nextPhase]) => {
      clearElapsedTimer();
      elapsedSeconds.value = 0;
      if (nextThreadId === null || !isActiveThreadRuntimePhase(nextPhase)) return;
      activeStartedAt = Date.now();
      elapsedTimer = setInterval(() => {
        if (activeStartedAt === null) return;
        elapsedSeconds.value = Math.max(0, Math.floor((Date.now() - activeStartedAt) / 1_000));
      }, 1_000);
    },
    { immediate: true },
  );

  onScopeDispose(clearElapsedTimer);

  return elapsedSeconds;
}
