import { defineStore } from "pinia";
import { ref } from "vue";
import type { QueuedSubmission } from "~~/shared/types";
import { pinnedKey } from "@/stores/gateway/thread-utils/identity";
import { captureSessionEpoch } from "@/utils/session-epoch";
import {
  requestThreadQueueAdd,
  requestThreadQueueDelete,
  requestThreadQueueList,
  requestThreadQueueReorder,
  requestThreadQueueStart,
  requestThreadQueueSteer,
  requestThreadQueueUpdate,
} from "./transport";

export const useGatewayThreadQueueStore = defineStore("gateway-thread-queue", () => {
  const itemsByThreadKey = ref<Record<string, QueuedSubmission[]>>({});
  const loadingThreadKeys = ref<string[]>([]);
  const loadRevisions = new Map<string, number>();

  function queueForThread(hostId: number, threadId: string) {
    return itemsByThreadKey.value[pinnedKey(hostId, threadId)] ?? [];
  }

  function replaceQueue(hostId: number, threadId: string, items: QueuedSubmission[]) {
    const key = pinnedKey(hostId, threadId);
    itemsByThreadKey.value = { ...itemsByThreadKey.value, [key]: [...items] };
  }

  async function loadQueue(hostId: number, threadId: string, options: { force?: boolean } = {}) {
    const key = pinnedKey(hostId, threadId);
    if (loadingThreadKeys.value.includes(key) && options.force !== true) return;
    const revision = (loadRevisions.get(key) ?? 0) + 1;
    loadRevisions.set(key, revision);
    loadingThreadKeys.value = [...new Set([...loadingThreadKeys.value, key])];
    const sessionIsCurrent = captureSessionEpoch();
    try {
      const response = await requestThreadQueueList({ hostId, threadId });
      if (!sessionIsCurrent() || loadRevisions.get(key) !== revision) return;
      replaceQueue(hostId, threadId, response.items);
    } finally {
      if (loadRevisions.get(key) === revision) {
        loadingThreadKeys.value = loadingThreadKeys.value.filter((candidate) => candidate !== key);
      }
    }
  }

  async function queueMessage(
    hostId: number,
    threadId: string,
    submission: Pick<QueuedSubmission, "input" | "clientUserMessageId">,
    signal?: AbortSignal,
  ) {
    const revision = currentRevision(hostId, threadId);
    const response = await requestThreadQueueAdd({ hostId, threadId, ...submission, signal });
    if (currentRevision(hostId, threadId) === revision) {
      upsert(hostId, threadId, response.item);
    }
    reconcileQueue(hostId, threadId);
    return response.item;
  }

  async function editQueuedMessage(
    hostId: number,
    threadId: string,
    queuedSubmissionId: string,
    text: string,
  ) {
    const revision = currentRevision(hostId, threadId);
    const response = await requestThreadQueueUpdate({
      hostId,
      threadId,
      queuedSubmissionId,
      input: [{ type: "text", text, text_elements: [] }],
    });
    if (currentRevision(hostId, threadId) === revision) {
      upsert(hostId, threadId, response.item);
    }
    reconcileQueue(hostId, threadId);
    return response.item;
  }

  async function deleteQueuedMessage(hostId: number, threadId: string, queuedSubmissionId: string) {
    const response = await requestThreadQueueDelete({ hostId, threadId, queuedSubmissionId });
    if (response.deleted) remove(hostId, threadId, queuedSubmissionId);
    return response.deleted;
  }

  async function reorderQueuedMessages(
    hostId: number,
    threadId: string,
    queuedSubmissionIds: string[],
  ) {
    const response = await requestThreadQueueReorder({
      hostId,
      threadId,
      queuedSubmissionIds,
    });
    invalidatePendingLoads(hostId, threadId);
    const current = new Map(queueForThread(hostId, threadId).map((item) => [item.id, item]));
    replaceQueue(
      hostId,
      threadId,
      response.queuedSubmissionIds.flatMap((id) => {
        const item = current.get(id);
        return item === undefined ? [] : [item];
      }),
    );
  }

  async function startQueuedMessage(
    hostId: number,
    threadId: string,
    queuedSubmissionId?: string | null,
  ) {
    const response = await requestThreadQueueStart({ hostId, threadId, queuedSubmissionId });
    if (response.queuedSubmissionId !== null && response.queuedSubmissionId !== undefined) {
      remove(hostId, threadId, response.queuedSubmissionId);
    }
    return response.turn;
  }

  async function steerQueuedMessage(
    hostId: number,
    threadId: string,
    queuedSubmissionId: string,
    expectedTurnId: string,
  ) {
    const response = await requestThreadQueueSteer({
      hostId,
      threadId,
      queuedSubmissionId,
      expectedTurnId,
    });
    if (response.deleted) remove(hostId, threadId, response.queuedSubmissionId);
    return response.turnId;
  }

  function upsert(hostId: number, threadId: string, item: QueuedSubmission) {
    invalidatePendingLoads(hostId, threadId);
    const current = queueForThread(hostId, threadId);
    const index = current.findIndex((candidate) => candidate.id === item.id);
    const next =
      index < 0
        ? [...current, item]
        : current.map((candidate) => (candidate.id === item.id ? item : candidate));
    replaceQueue(hostId, threadId, next);
  }

  function remove(hostId: number, threadId: string, queuedSubmissionId: string) {
    invalidatePendingLoads(hostId, threadId);
    replaceQueue(
      hostId,
      threadId,
      queueForThread(hostId, threadId).filter((item) => item.id !== queuedSubmissionId),
    );
  }

  function invalidatePendingLoads(hostId: number, threadId: string) {
    const key = pinnedKey(hostId, threadId);
    loadRevisions.set(key, (loadRevisions.get(key) ?? 0) + 1);
    loadingThreadKeys.value = loadingThreadKeys.value.filter((candidate) => candidate !== key);
  }

  function currentRevision(hostId: number, threadId: string) {
    return loadRevisions.get(pinnedKey(hostId, threadId)) ?? 0;
  }

  function reconcileQueue(hostId: number, threadId: string) {
    void loadQueue(hostId, threadId, { force: true }).catch(() => {
      // The next App Server notification or reconnect retries the authoritative projection.
    });
  }

  function clearHost(hostId: number) {
    const prefix = `${hostId}:`;
    itemsByThreadKey.value = Object.fromEntries(
      Object.entries(itemsByThreadKey.value).filter(([key]) => !key.startsWith(prefix)),
    );
  }

  function resetState() {
    itemsByThreadKey.value = {};
    loadingThreadKeys.value = [];
    loadRevisions.clear();
  }

  return {
    itemsByThreadKey,
    loadingThreadKeys,
    queueForThread,
    replaceQueue,
    loadQueue,
    queueMessage,
    editQueuedMessage,
    deleteQueuedMessage,
    reorderQueuedMessages,
    startQueuedMessage,
    steerQueuedMessage,
    clearHost,
    resetState,
  };
});
