import { defineStore } from "pinia";
import { reactive, toRefs } from "vue";
import type { ComposerTurnOptions } from "~~/shared/types";
import { pinnedKey } from "../gateway/thread-utils/identity";
import { createGatewayThreadTurnActions } from "./actions";

export interface SubmittedTurnRequestState {
  kind: "start" | "steer";
  hostId: number;
  projectId: number | null;
  threadId: string;
  cwd: string | null;
  text: string;
  options: ComposerTurnOptions;
  retryCount: number;
  pendingRetryTurnId: string | null;
  retryTimer: number | null;
  retryAt: number | null;
}

export type SubmittedTurnRequestInput = Omit<
  SubmittedTurnRequestState,
  "retryCount" | "pendingRetryTurnId" | "retryTimer" | "retryAt"
>;

export const useGatewayThreadTurnsStore = defineStore("gateway-thread-turns", () => {
  const state = reactive<{
    submittedTurnRequestsByKey: Record<string, SubmittedTurnRequestState>;
    lastTurnRequestsByKey: Record<string, SubmittedTurnRequestInput>;
    loadingTurnItemsByKey: Record<string, boolean>;
  }>({
    submittedTurnRequestsByKey: {},
    lastTurnRequestsByKey: {},
    loadingTurnItemsByKey: {},
  });

  function requestKey(hostId: number, threadId: string) {
    return pinnedKey(hostId, threadId);
  }

  function requestForThread(hostId: number, threadId: string) {
    return state.submittedTurnRequestsByKey[requestKey(hostId, threadId)];
  }

  function rememberRequest(input: SubmittedTurnRequestInput) {
    const key = requestKey(input.hostId, input.threadId);
    const existing = state.submittedTurnRequestsByKey[key];
    if (existing?.retryTimer !== null && existing?.retryTimer !== undefined) {
      clearTimeout(existing.retryTimer);
    }
    state.submittedTurnRequestsByKey = {
      ...state.submittedTurnRequestsByKey,
      [key]: {
        ...input,
        retryCount: 0,
        pendingRetryTurnId: null,
        retryTimer: null,
        retryAt: null,
      },
    };
    state.lastTurnRequestsByKey = {
      ...state.lastTurnRequestsByKey,
      [key]: input,
    };
  }

  function clearRequest(hostId: number, threadId: string) {
    const key = requestKey(hostId, threadId);
    const existing = state.submittedTurnRequestsByKey[key];
    if (existing?.retryTimer !== null && existing?.retryTimer !== undefined) {
      clearTimeout(existing.retryTimer);
    }
    const { [key]: _removed, ...remaining } = state.submittedTurnRequestsByKey;
    state.submittedTurnRequestsByKey = remaining;
  }

  function patchRequest(
    hostId: number,
    threadId: string,
    patch: Partial<SubmittedTurnRequestState>,
  ) {
    const key = requestKey(hostId, threadId);
    const current = state.submittedTurnRequestsByKey[key];
    if (current === undefined) {
      return;
    }
    state.submittedTurnRequestsByKey = {
      ...state.submittedTurnRequestsByKey,
      [key]: {
        ...current,
        ...patch,
      },
    };
  }

  function setRequest(key: string, request: SubmittedTurnRequestState) {
    state.submittedTurnRequestsByKey = {
      ...state.submittedTurnRequestsByKey,
      [key]: request,
    };
  }

  function requestByKey(key: string) {
    return state.submittedTurnRequestsByKey[key];
  }

  function lastRequestForThread(hostId: number, threadId: string) {
    return state.lastTurnRequestsByKey[requestKey(hostId, threadId)];
  }

  function resetState() {
    for (const request of Object.values(state.submittedTurnRequestsByKey)) {
      if (request.retryTimer !== null) {
        clearTimeout(request.retryTimer);
      }
    }
    state.submittedTurnRequestsByKey = {};
    state.lastTurnRequestsByKey = {};
    state.loadingTurnItemsByKey = {};
  }

  function turnItemsKey(hostId: number, threadId: string, turnId: string) {
    return `${pinnedKey(hostId, threadId)}:${turnId}`;
  }

  function setTurnItemsLoading(hostId: number, threadId: string, turnId: string, loading: boolean) {
    const key = turnItemsKey(hostId, threadId, turnId);
    if (loading) {
      state.loadingTurnItemsByKey = { ...state.loadingTurnItemsByKey, [key]: true };
      return;
    }
    const { [key]: _removed, ...remaining } = state.loadingTurnItemsByKey;
    state.loadingTurnItemsByKey = remaining;
  }

  const actions = createGatewayThreadTurnActions();

  return {
    ...toRefs(state),
    requestKey,
    requestForThread,
    rememberRequest,
    clearRequest,
    patchRequest,
    setRequest,
    requestByKey,
    lastRequestForThread,
    turnItemsKey,
    setTurnItemsLoading,
    resetState,
    ...actions,
  };
});
