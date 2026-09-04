import { useGatewayCatalogStore } from "@/stores/gateway-catalog";
import { useGatewayComposerStore } from "@/stores/gateway-composer";
import { useGatewayFileWorkspaceStore } from "@/stores/file-workspace";
import { useGatewayThreadActivityStore } from "@/stores/gateway-thread-activity";
import { useGatewayThreadRuntimeStore } from "@/stores/gateway-thread-runtime";
import { useGatewayNavigationStore } from "@/stores/gateway-navigation";
import { useGatewayConfigStore } from "@/stores/gateway-config";
import { useGatewayThreadViewStore } from "@/stores/gateway-thread-view";
import { patchThreadView } from "@/stores/gateway/thread-open/thread-view-cache";
import { pinnedKey } from "@/stores/gateway/thread-utils/identity";
import { gatewayDomainEvents } from "../domain-events";
import {
  clearActiveTerminalProcess,
  rememberActiveTerminalProcess,
} from "../thread-turns/terminal-processes";

export function registerThreadProjectionSubscribers() {
  gatewayDomainEvents.on("thread-summary-detected", (event) => {
    useGatewayThreadActivityStore().upsertAppServerThread(
      event.hostId,
      event.thread,
      useGatewayCatalogStore().projects,
    );
  });
  gatewayDomainEvents.on("thread-title-detected", projectThreadTitle);
  gatewayDomainEvents.on("remote-files-changed", (event) => {
    useGatewayFileWorkspaceStore().markRemoteFilesChanged(
      event.hostId,
      event.threadId,
      event.paths,
    );
  });
  gatewayDomainEvents.on("thread-status-detected", (event) => {
    useGatewayThreadRuntimeStore().setThreadStatus(event.hostId, event.threadId, event.status, {
      phase: event.phase,
      turnId: event.turnId,
    });
  });
  gatewayDomainEvents.on("terminal-process-detected", rememberActiveTerminalProcess);
  gatewayDomainEvents.on("terminal-process-completed", clearActiveTerminalProcess);
  gatewayDomainEvents.on("thread-settings-detected", (event) => {
    useGatewayComposerStore().setThreadSettings(event.hostId, event.threadId, event.settings);
  });
  gatewayDomainEvents.on("thread-token-usage-detected", (event) => {
    useGatewayThreadRuntimeStore().setThreadTokenUsage(
      event.hostId,
      event.threadId,
      event.tokenUsage,
    );
  });
}

function projectThreadTitle(event: { hostId: number; threadId: string; title: string }) {
  const navigation = useGatewayNavigationStore();
  const rename = <T extends { id: string | number }>(thread: T) =>
    String(thread.id) === event.threadId
      ? { ...thread, title: event.title, name: event.title }
      : thread;
  if (navigation.selectedHostId === event.hostId) {
    navigation.threads = navigation.threads.map(rename);
    navigation.hostThreads = navigation.hostThreads.map(rename);
  }
  useGatewayThreadActivityStore().updateTitle(event.hostId, event.threadId, event.title);
  const config = useGatewayConfigStore();
  config.gatewayConfig.pinnedThreads = config.gatewayConfig.pinnedThreads.map((thread) =>
    pinnedKey(thread.hostId, thread.threadId) === pinnedKey(event.hostId, event.threadId)
      ? { ...thread, title: event.title }
      : thread,
  );
  const views = useGatewayThreadViewStore();
  if (
    navigation.selectedHostId === event.hostId &&
    navigation.selectedThreadId === event.threadId &&
    views.currentThread !== null
  ) {
    views.currentThread = { ...views.currentThread, name: event.title };
  }
  const cached = views.threadViews[pinnedKey(event.hostId, event.threadId)];
  if (cached?.currentThread !== null && cached?.currentThread !== undefined) {
    patchThreadView(event.hostId, event.threadId, {
      currentThread: { ...cached.currentThread, name: event.title },
    });
  }
}
