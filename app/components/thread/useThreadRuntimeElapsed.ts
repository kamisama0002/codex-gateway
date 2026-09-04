import { onScopeDispose, ref, watch, type Ref } from "vue";
import type { ThreadRuntimePhase } from "~~/shared/types";
import { isActiveThreadRuntimePhase } from "~~/shared/thread-runtime-status";

export function useThreadRuntimeElapsed(
  threadId: Readonly<Ref<string | null>>,
  phase: Readonly<Ref<ThreadRuntimePhase>>,
) {
  const elapsedSeconds = ref(0);
  let elapsedTimer: ReturnType<typeof setInterval> | null = null;

  function clearElapsedTimer() {
    if (elapsedTimer === null) return;
    clearInterval(elapsedTimer);
    elapsedTimer = null;
  }

  watch(
    [threadId, phase],
    ([nextThreadId, nextPhase]) => {
      clearElapsedTimer();
      elapsedSeconds.value = 0;
      if (nextThreadId === null || !isActiveThreadRuntimePhase(nextPhase)) return;
      elapsedTimer = setInterval(() => {
        elapsedSeconds.value += 1;
      }, 1_000);
    },
    { immediate: true },
  );

  onScopeDispose(clearElapsedTimer);

  return elapsedSeconds;
}
