import { storeToRefs } from "pinia";
import { computed } from "vue";
import { useGatewayTerminalTransport } from "@/composables/terminal/useGatewayTerminalTransport";
import { createUuid } from "@/lib/uuid";
import { useGatewayCatalogStore } from "@/stores/gateway-catalog";
import { hostById, projectById } from "@/stores/gateway-catalog/selectors";
import { useGatewayBrowserStore } from "@/stores/gateway-browser";
import { useGatewayNavigationStore } from "@/stores/gateway-navigation";
import { useGatewayThreadViewStore } from "@/stores/gateway-thread-view";
import { useGatewayWorkspaceLayoutStore } from "@/stores/gateway-workspace-layout";
import { threadTitleFallbacks, titleForThread } from "@/stores/gateway/thread-utils/identity";
import { useGatewayHostMetricsPanelStore } from "@/stores/gateway-host-metrics/panels";
import { useFileGitReviewPanelStore } from "@/stores/file-workspace/git/review-panel";
import { workspaceLayoutScopeKey } from "@/stores/gateway-workspace-layout";
import {
  browserWorkspacePanelId,
  FILES_WORKSPACE_PANEL_ID,
  GIT_REVIEW_WORKSPACE_PANEL_ID,
  HOST_METRICS_WORKSPACE_PANEL_ID,
} from "@/stores/gateway/workspace-panels";
import {
  isInsideManagedWorkspace,
  isManagedRuntimeHost,
  MANAGED_WORKSPACE_PATH,
} from "~~/shared/runtime/managed-runtime";

export function useWorkspaceLaunchActions() {
  const gateway = useGatewayCatalogStore();
  const navigation = useGatewayNavigationStore();
  const threadView = useGatewayThreadViewStore();
  const browser = useGatewayBrowserStore();
  const layout = useGatewayWorkspaceLayoutStore();
  const terminal = useGatewayTerminalTransport();
  const hostMetricsPanels = useGatewayHostMetricsPanelStore();
  const gitReviewPanels = useFileGitReviewPanelStore();
  const { hosts, projects } = storeToRefs(gateway);
  const { selectedHostId, selectedProjectId, selectedThreadId } = storeToRefs(navigation);
  const { t } = useI18n();
  const selectedHost = computed(() => hostById(hosts.value, selectedHostId.value));
  const selectedProject = computed(() => projectById(projects.value, selectedProjectId.value));
  const isLocalAgentHost = computed(
    () => selectedHost.value !== null && isManagedRuntimeHost(selectedHost.value),
  );

  function currentScopeKey() {
    return workspaceLayoutScopeKey(
      selectedHostId.value,
      selectedProjectId.value,
      selectedThreadId.value,
    );
  }

  function openFiles() {
    if (selectedThreadId.value === null) return;
    const scopeKey = currentScopeKey();
    layout.setFilesPanelOpen(scopeKey, true);
    layout.setToolSidebarOpen(scopeKey, true);
    layout.requestPanelActivation(FILES_WORKSPACE_PANEL_ID);
  }

  function openGitReview() {
    if (selectedThreadId.value === null) return;
    const scopeKey = currentScopeKey();
    gitReviewPanels.open(scopeKey);
    layout.setToolSidebarOpen(scopeKey, true);
    layout.requestPanelActivation(GIT_REVIEW_WORKSPACE_PANEL_ID);
  }

  function openTerminal() {
    if (selectedHostId.value === null || selectedHost.value === null) return;
    if (selectedThreadId.value !== null) {
      const thread = threadView.currentThread;
      void terminal.openTerminal({
        scope: "thread",
        hostId: selectedHostId.value,
        projectId: selectedProjectId.value,
        threadId: selectedThreadId.value,
        cwd: terminalCwd(
          thread?.cwd ?? selectedProject.value?.remotePath ?? null,
          isLocalAgentHost.value,
        ),
        title: titleForThread(
          thread ?? { id: selectedThreadId.value },
          threadTitleFallbacks(t),
          threadView.history,
        ),
      });
      return;
    }
    if (selectedProject.value !== null) {
      void terminal.openTerminal({
        scope: "project",
        hostId: selectedProject.value.hostId,
        projectId: selectedProject.value.id,
        cwd: terminalCwd(selectedProject.value.remotePath, isLocalAgentHost.value),
        title: selectedProject.value.name,
      });
      return;
    }
    void terminal.openTerminal({
      scope: "host",
      hostId: selectedHostId.value,
      cwd: terminalCwd(null, isLocalAgentHost.value),
      title: selectedHost.value.name,
    });
  }

  function openBrowser(targetUrl: string) {
    if (selectedHostId.value === null || isLocalAgentHost.value) return;
    const panelId = createUuid();
    browser.addPanel({
      panelId,
      title: browserTitle(targetUrl),
      targetUrl,
      hostId: selectedHostId.value,
      projectId: selectedProjectId.value,
      threadId: selectedThreadId.value,
    });
    layout.requestPanelActivation(browserWorkspacePanelId(panelId));
  }

  function openHostMonitor() {
    if (selectedHostId.value === null) return;
    const scopeKey = currentScopeKey();
    hostMetricsPanels.open(scopeKey);
    layout.setToolSidebarOpen(scopeKey, true);
    layout.requestPanelActivation(HOST_METRICS_WORKSPACE_PANEL_ID);
  }

  return {
    canOpenTerminal: computed(() => selectedHostId.value !== null),
    canOpenBrowser: computed(() => selectedHostId.value !== null && !isLocalAgentHost.value),
    canLaunch: computed(() => selectedHostId.value !== null && !isLocalAgentHost.value),
    canOpenThreadTools: computed(() => selectedThreadId.value !== null),
    canMonitorHost: computed(() => selectedHostId.value !== null),
    selectedHostTitle: computed(() =>
      selectedHost.value === null || isLocalAgentHost.value
        ? t("app.workspaces")
        : selectedHost.value.name,
    ),
    openFiles,
    openGitReview,
    openTerminal,
    openBrowser,
    openHostMonitor,
  };
}

function terminalCwd(cwd: string | null, managed: boolean) {
  if (!managed) return cwd;
  if (
    cwd !== null &&
    isInsideManagedWorkspace(cwd) &&
    !cwd.split("/").some((segment) => segment === "." || segment === "..") &&
    !cwd.includes("\0")
  ) {
    return cwd;
  }
  return MANAGED_WORKSPACE_PATH;
}

function browserTitle(targetUrl: string) {
  try {
    return new URL(/:\/\//.test(targetUrl) ? targetUrl : `http://${targetUrl}`).host;
  } catch {
    return targetUrl;
  }
}
