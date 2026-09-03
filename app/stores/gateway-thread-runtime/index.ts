import { computed, ref } from "vue";
import { defineStore } from "pinia";
import type {
  ThreadRuntimePhase,
  ThreadRuntimeStatus,
  ThreadTokenUsageState,
} from "~~/shared/types";
import { runtimePhaseFromStatus } from "~~/shared/thread-runtime-status";
import { pinnedKey } from "@/stores/gateway/thread-utils/identity";
import { createThreadRuntimeActions } from "./actions/runtime";

export interface ActiveTerminalProcess {
  turnId: string;
  itemId: string;
  processId: string;
}

export const useGatewayThreadRuntimeStore = defineStore("gateway-thread-runtime", () => {
  const runningThreadKeys = ref<string[]>([]);
  const threadStatuses = ref<Record<string, ThreadRuntimeStatus>>({});
  const threadPhases = ref<Record<string, ThreadRuntimePhase>>({});
  const unviewedCompletedThreadKeys = ref<string[]>([]);
  const activeTurnIdsByThreadKey = ref<Record<string, string>>({});
  const activeTerminalProcessByThreadKey = ref<Record<string, ActiveTerminalProcess>>({});
  const threadTokenUsageByKey = ref<Record<string, ThreadTokenUsageState>>({});
  const runningThreadKeySet = computed(() => new Set(runningThreadKeys.value));
  const actions = createThreadRuntimeActions();

  function statusFor(hostId: number, threadId: string): ThreadRuntimeStatus {
    return threadStatuses.value[pinnedKey(hostId, threadId)] ?? "idle";
  }

  function phaseFor(hostId: number, threadId: string): ThreadRuntimePhase {
    const key = pinnedKey(hostId, threadId);
    return threadPhases.value[key] ?? runtimePhaseFromStatus(threadStatuses.value[key] ?? "idle");
  }

  function resetState() {
    runningThreadKeys.value = [];
    threadStatuses.value = {};
    threadPhases.value = {};
    unviewedCompletedThreadKeys.value = [];
    activeTurnIdsByThreadKey.value = {};
    activeTerminalProcessByThreadKey.value = {};
    threadTokenUsageByKey.value = {};
  }

  return {
    runningThreadKeys,
    threadStatuses,
    threadPhases,
    unviewedCompletedThreadKeys,
    activeTurnIdsByThreadKey,
    activeTerminalProcessByThreadKey,
    threadTokenUsageByKey,
    runningThreadKeySet,
    statusFor,
    phaseFor,
    resetState,
    ...actions,
  };
});
