import { computed, ref, watch, type Ref } from "vue";
import { useGatewayBootstrapStore } from "@/stores/gateway-bootstrap";
import { useGatewayThreadQueueStore } from "@/stores/gateway-thread-queue";
import { gatewayErrorMessage } from "@/utils/gateway-error";
import { moveQueuedSubmissionIds } from "@/components/chat/composer/queue-presentation";
import { useGatewayTranslator } from "@/composables/i18n/useGatewayTranslator";

export function useComposerQueue(input: {
  selectedHostId: Ref<number | null>;
  selectedThreadId: Ref<string | null>;
  threadRunning: Ref<boolean>;
  activeTurnId: Ref<string | null>;
}) {
  const t = useGatewayTranslator();
  const bootstrap = useGatewayBootstrapStore();
  const queue = useGatewayThreadQueueStore();
  const actionPendingId = ref<string | null>(null);
  const items = computed(() => {
    const hostId = input.selectedHostId.value;
    const threadId = input.selectedThreadId.value;
    return hostId === null || threadId === null ? [] : queue.queueForThread(hostId, threadId);
  });
  const loading = computed(() => {
    const hostId = input.selectedHostId.value;
    const threadId = input.selectedThreadId.value;
    return (
      hostId !== null &&
      threadId !== null &&
      queue.loadingThreadKeys.includes(`${hostId}:${threadId}`)
    );
  });

  watch(
    [input.selectedHostId, input.selectedThreadId],
    ([hostId, threadId]) => {
      if (hostId === null || threadId === null) return;
      void queue.loadQueue(hostId, threadId).catch(() => {
        // Realtime queue notifications retry authoritative hydration. Avoid turning background
        // decoration into a blocking overlay while a Turn is running.
      });
    },
    { immediate: true },
  );

  async function edit(id: string, text: string) {
    return run(id, (hostId, threadId) => queue.editQueuedMessage(hostId, threadId, id, text));
  }

  async function remove(id: string) {
    return run(id, (hostId, threadId) => queue.deleteQueuedMessage(hostId, threadId, id));
  }

  async function move(id: string, direction: "up" | "down") {
    const ids = moveQueuedSubmissionIds(items.value, id, direction);
    if (ids.every((candidate, index) => candidate === items.value[index]?.id)) return;
    return run(id, (hostId, threadId) => queue.reorderQueuedMessages(hostId, threadId, ids));
  }

  async function sendNow(id: string) {
    return run(id, (hostId, threadId) => {
      if (!input.threadRunning.value) return queue.startQueuedMessage(hostId, threadId, id);
      const activeTurnId = input.activeTurnId.value;
      if (activeTurnId === null) throw new Error(t("app.queueSteerUnavailable"));
      return queue.steerQueuedMessage(hostId, threadId, id, activeTurnId);
    });
  }

  async function run(
    id: string,
    operation: (hostId: number, threadId: string) => Promise<unknown>,
  ) {
    const hostId = input.selectedHostId.value;
    const threadId = input.selectedThreadId.value;
    if (hostId === null || threadId === null || actionPendingId.value !== null) return;
    actionPendingId.value = id;
    try {
      await operation(hostId, threadId);
    } catch (error: unknown) {
      bootstrap.setError(gatewayErrorMessage(error, t("app.queueActionFailed")), {
        hostId,
        threadId,
      });
    } finally {
      actionPendingId.value = null;
    }
  }

  return { items, loading, actionPendingId, edit, remove, move, sendNow };
}
