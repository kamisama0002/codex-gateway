import { computed, ref } from "vue";
import { useGatewayBootstrapStore } from "@/stores/gateway-bootstrap";
import { useGatewayNavigationStore } from "@/stores/gateway-navigation";
import { messageFromError } from "@/stores/gateway/thread-utils/identity";
import { gatewayErrorPayload } from "@/utils/gateway-error";
import type { SidebarThreadRow } from "../sidebar-types";

export function useThreadLifecycle() {
  const navigation = useGatewayNavigationStore();
  const bootstrap = useGatewayBootstrapStore();
  const deleteTarget = ref<{ hostId: number; threadId: string } | null>(null);
  const deleting = ref(false);
  const deleteOpen = computed({
    get: () => deleteTarget.value !== null,
    set: (value) => {
      if (!value) cancelDelete();
    },
  });

  function idsFor(thread: SidebarThreadRow) {
    const hostId = "hostId" in thread ? Number(thread.hostId) : Number(navigation.selectedHostId);
    const threadIdValue =
      "threadId" in thread &&
      (typeof thread.threadId === "string" || typeof thread.threadId === "number")
        ? thread.threadId
        : "id" in thread
          ? thread.id
          : null;
    const threadId = threadIdValue === null ? "" : String(threadIdValue);
    return { hostId, threadId };
  }

  async function archive(thread: SidebarThreadRow) {
    const { hostId, threadId } = idsFor(thread);
    if (!hostId || !threadId) return;
    try {
      await navigation.archiveThread(hostId, threadId);
    } catch (error: unknown) {
      bootstrap.setError(
        isThreadRolloutNotReady(error)
          ? bootstrap.t("app.archiveThreadNotReady")
          : messageFromError(error, bootstrap.t("app.archiveThreadFailed"), bootstrap.errorLabels),
        { hostId, threadId },
      );
    }
  }

  async function unarchive(thread: SidebarThreadRow) {
    const { hostId, threadId } = idsFor(thread);
    if (!hostId || !threadId) return;
    try {
      await navigation.unarchiveThread(hostId, threadId);
    } catch (error: unknown) {
      bootstrap.setError(
        messageFromError(error, bootstrap.t("app.unarchiveThreadFailed"), bootstrap.errorLabels),
        { hostId, threadId },
      );
    }
  }

  async function unarchiveAndOpen(thread: SidebarThreadRow, projectId: number | null) {
    const { hostId, threadId } = idsFor(thread);
    if (!hostId || !threadId) return;
    try {
      await navigation.unarchiveAndOpen(hostId, threadId, projectId);
    } catch (error: unknown) {
      bootstrap.setError(
        messageFromError(error, bootstrap.t("app.unarchiveThreadFailed"), bootstrap.errorLabels),
        { hostId, threadId },
      );
    }
  }

  function startDelete(thread: SidebarThreadRow) {
    const { hostId, threadId } = idsFor(thread);
    if (!hostId || !threadId) return;
    deleteTarget.value = { hostId, threadId };
  }

  async function confirmDelete() {
    const target = deleteTarget.value;
    if (!target) return;
    deleting.value = true;
    try {
      await navigation.deleteThread(target.hostId, target.threadId);
      deleteTarget.value = null;
    } catch (error: unknown) {
      bootstrap.setError(
        messageFromError(error, bootstrap.t("app.deleteThreadFailed"), bootstrap.errorLabels),
        { hostId: target.hostId, threadId: target.threadId },
      );
    } finally {
      deleting.value = false;
    }
  }

  function cancelDelete() {
    if (deleting.value) return;
    deleteTarget.value = null;
  }

  return {
    deleteOpen,
    deleting,
    archive,
    unarchive,
    unarchiveAndOpen,
    startDelete,
    confirmDelete,
    cancelDelete,
  };
}

function isThreadRolloutNotReady(error: unknown) {
  const payload = gatewayErrorPayload(error);
  return payload.code === "thread_rollout_not_ready" || payload.statusMessage === "thread_rollout_not_ready";
}
