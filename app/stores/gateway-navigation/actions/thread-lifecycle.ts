import type { GatewayThread } from "~~/shared/types";
import { gatewayApi } from "@/utils/gateway-api";
import { useGatewayBootstrapStore } from "@/stores/gateway-bootstrap";
import { useGatewayConfigStore } from "@/stores/gateway-config";
import { useGatewayNavigationStore } from "@/stores/gateway-navigation";
import { useGatewayRealtimeStore } from "@/stores/gateway-realtime";
import { useGatewayThreadActivityStore } from "@/stores/gateway-thread-activity";
import { useGatewayThreadViewStore } from "@/stores/gateway-thread-view";
import { writeGatewayRouteSelection } from "@/stores/gateway/route-state";
import { removeThreadView } from "@/stores/gateway/thread-open/thread-view-cache";
import { messageFromError, pinnedKey, sortThreads } from "@/stores/gateway/thread-utils/identity";
import { isAppServerSubAgentThread } from "~~/shared/runtime/app-server";
import { captureSessionEpoch } from "@/utils/session-epoch";
import type { ThreadListResponse } from "@/stores/gateway/types";

export type ThreadCatalogAction = "archived" | "unarchived" | "deleted";

export interface ThreadCatalogUpdate {
  hostId: number;
  threadId: string;
  action: ThreadCatalogAction;
  thread: GatewayThread | null;
}

export function createThreadLifecycleActions() {
  return {
    applyThreadCatalogUpdate,
    listArchivedThreads,
    async setArchivedFilter(active: boolean) {
      const navigation = useGatewayNavigationStore();
      if (navigation.archivedFilterActive === active) return;
      navigation.archivedFilterActive = active;
      if (active) {
        await listArchivedThreads();
        return;
      }
      navigation.archivedThreads = [];
      navigation.archivedLoadedKey = null;
    },
    archiveThread,
    unarchiveThread,
    async unarchiveAndOpen(hostId: number, threadId: string, projectId: number | null) {
      await unarchiveThread(hostId, threadId);
      await useGatewayThreadViewStore().openThread(threadId, { hostId, projectId });
    },
    deleteThread,
  };
}

async function archiveThread(hostId: number, threadId: string) {
  await gatewayApi("/api/threads/archive", { method: "POST", body: { hostId, threadId } });
  applyThreadCatalogUpdate({ hostId, threadId, action: "archived", thread: null });
}

async function unarchiveThread(hostId: number, threadId: string) {
  const response = await gatewayApi<{ thread: GatewayThread }>("/api/threads/unarchive", {
    method: "POST",
    body: { hostId, threadId },
  });
  applyThreadCatalogUpdate({
    hostId,
    threadId,
    action: "unarchived",
    thread: response.thread,
  });
  return response.thread;
}

async function deleteThread(hostId: number, threadId: string) {
  await gatewayApi("/api/threads/delete", { method: "POST", body: { hostId, threadId } });
  applyThreadCatalogUpdate({ hostId, threadId, action: "deleted", thread: null });
}

export async function listArchivedThreads() {
  const bootstrap = useGatewayBootstrapStore();
  const navigation = useGatewayNavigationStore();
  const hostId = navigation.selectedHostId;
  if (hostId === null) return;
  const sessionIsCurrent = captureSessionEpoch();
  navigation.archivedLoading = true;
  try {
    const response = await gatewayApi<ThreadListResponse>("/api/threads", {
      query: { hostId, limit: 50, archived: true },
    });
    if (!sessionIsCurrent()) return;
    if (navigation.selectedHostId !== hostId) return;
    navigation.archivedThreads = (response.data ?? []).filter(
      (thread) => !isAppServerSubAgentThread(thread),
    );
    navigation.archivedLoadedKey = archivedScopeKey(hostId);
  } catch (error: unknown) {
    if (!sessionIsCurrent()) return;
    bootstrap.setError(
      messageFromError(error, bootstrap.t("app.listArchivedThreadsFailed"), bootstrap.errorLabels),
      { hostId, projectId: navigation.selectedProjectId, threadId: navigation.selectedThreadId },
    );
  } finally {
    if (sessionIsCurrent() && navigation.selectedHostId === hostId) {
      navigation.archivedLoading = false;
    }
  }
}

export function applyThreadCatalogUpdate(update: ThreadCatalogUpdate) {
  const navigation = useGatewayNavigationStore();
  const config = useGatewayConfigStore();
  const key = pinnedKey(update.hostId, update.threadId);

  if (update.action === "unarchived") {
    navigation.archivedThreads = navigation.archivedThreads.filter(
      (thread) => String(thread.id) !== update.threadId,
    );
    if (update.thread && update.hostId === navigation.selectedHostId) {
      if (!navigation.threads.some((thread) => String(thread.id) === update.threadId)) {
        navigation.threads = sortThreads([update.thread, ...navigation.threads]);
      }
      if (!navigation.hostThreads.some((thread) => String(thread.id) === update.threadId)) {
        navigation.hostThreads = sortThreads([update.thread, ...navigation.hostThreads]);
      }
    }
    return;
  }

  navigation.threads = navigation.threads.filter((thread) => String(thread.id) !== update.threadId);
  navigation.hostThreads = navigation.hostThreads.filter(
    (thread) => String(thread.id) !== update.threadId,
  );
  if (update.action === "deleted") {
    navigation.archivedThreads = navigation.archivedThreads.filter(
      (thread) => String(thread.id) !== update.threadId,
    );
  }
  useGatewayThreadActivityStore().remove(update.hostId, update.threadId);
  if (
    navigation.archivedFilterActive &&
    navigation.archivedLoadedKey === archivedScopeKey(navigation.selectedHostId)
  ) {
    void listArchivedThreads();
  }

  config.gatewayConfig.pinnedThreads = config.gatewayConfig.pinnedThreads.filter(
    (thread) => pinnedKey(thread.hostId, thread.threadId) !== key,
  );
  leaveThreadIfOpen(update.hostId, update.threadId);
}

function leaveThreadIfOpen(hostId: number, threadId: string) {
  const navigation = useGatewayNavigationStore();
  if (navigation.selectedHostId !== hostId || navigation.selectedThreadId !== threadId) return;
  useGatewayRealtimeStore().closeThreadEvents(hostId, threadId);
  removeThreadView(hostId, threadId);
  navigation.selectedThreadId = null;
  useGatewayThreadViewStore().resetCurrentView();
  useGatewayBootstrapStore().clearError();
  const selection = {
    hostId: navigation.selectedHostId,
    projectId: navigation.selectedProjectId,
    threadId: null,
  };
  navigation.rememberOpenThread(selection);
  writeGatewayRouteSelection(selection);
}

function archivedScopeKey(hostId: number | null) {
  return `${hostId ?? ""}`;
}
