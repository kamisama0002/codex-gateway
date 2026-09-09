<script setup lang="ts">
import { DockviewVue, themeDark, themeLight } from "dockview-vue";
import { computed, provide, ref, toRefs } from "vue";
import { useTerminalTheme } from "@/composables/terminal/useTerminalTheme";
import { useWorkspaceLaunchActions } from "@/composables/workspace/useWorkspaceLaunchActions";
import { useTmuxMonitorLauncher } from "@/composables/workspace/useTmuxMonitorLauncher";
import { useChatWorkspaceState } from "../chat-workspace-state";
import BrowserOpenDialog from "@/components/browser/BrowserOpenDialog.vue";
import { fileWorkspaceScopeKey, fileWorkspaceThreadId } from "@/stores/file-workspace/paths";
import {
  useGatewayWorkspaceLayoutStore,
  workspaceLayoutScopeKey,
} from "@/stores/gateway-workspace-layout";
import { AGENT_WORKSPACE_PANEL_ID } from "@/stores/gateway/workspace-panels";
import { useGatewayThreadViewStore } from "@/stores/gateway-thread-view";
import { createWorkspaceToolCatalog } from "@/components/chat/workspace-tools/tool-catalog";
import MobileWorkspaceHeader from "../MobileWorkspaceHeader.vue";
import { WORKSPACE_DOCK_UI_CONTEXT, WORKSPACE_FILES_PANEL_CONTEXT } from "./context";
import type { WorkspaceDockProps } from "./types";
import { useWorkspaceDockLifecycle } from "./useWorkspaceDockLifecycle";
import { useWorkspaceDockPanels } from "./useWorkspaceDockPanels";
import { useWorkspacePanels } from "./useWorkspacePanels";
import "dockview-vue/dist/styles/dockview.css";

const props = defineProps<WorkspaceDockProps>();
const refs = toRefs(props);
const workspace = useChatWorkspaceState();
const workspaceLayout = useGatewayWorkspaceLayoutStore();
const threadView = useGatewayThreadViewStore();
const { isDark } = useTerminalTheme();
const scopeKey = computed(() =>
  workspaceLayoutScopeKey(
    workspace.selectedHostId.value,
    workspace.selectedProjectId.value,
    workspace.selectedThreadId.value,
  ),
);
const mobileToolsOpen = ref(false);
const toolSidebarOpen = computed(() =>
  props.layout === "mobile"
    ? mobileToolsOpen.value
    : workspaceLayout.isToolSidebarOpen(scopeKey.value),
);
const {
  terminalPanels,
  subAgentPanels,
  browserPanels,
  tmuxPanels,
  hostMetricsPanel,
  gitReviewPanel,
  fileWorkspaceRoot,
} = useWorkspacePanels({
  selectedHostId: workspace.selectedHostId,
  selectedProjectId: workspace.selectedProjectId,
  selectedThreadId: workspace.selectedThreadId,
});
const workspaceActions = useWorkspaceLaunchActions();
const fileThreadId = computed(() =>
  workspace.selectedHostId.value === null
    ? null
    : fileWorkspaceThreadId(
        workspace.selectedHostId.value,
        workspace.selectedProjectId.value,
        workspace.selectedThreadId.value,
      ),
);
const fileRequestScopeKey = computed(() =>
  workspace.selectedHostId.value !== null && fileThreadId.value !== null
    ? fileWorkspaceScopeKey(workspace.selectedHostId.value, fileThreadId.value)
    : null,
);
const fileWorkspaceAvailable = computed(
  () => workspaceActions.canOpenFiles.value && fileThreadId.value !== null,
);
const panels = useWorkspaceDockPanels({
  layout: refs.layout,
  filesPanelAvailable: fileWorkspaceAvailable,
  filesPanelOpen: computed(() => workspaceLayout.isFilesPanelOpen(scopeKey.value)),
  toolSidebarOpen,
  terminalPanels,
  subAgentPanels,
  browserPanels,
  tmuxPanels,
  hostMetricsPanel,
  gitReviewPanel,
  scopeKey,
});
const panelIds = computed(() => [
  workspaceLayout.isFilesPanelOpen(scopeKey.value),
  terminalPanels.value.map(({ id }) => id),
  subAgentPanels.value.map(({ id }) => id),
  browserPanels.value.map(({ id }) => id),
  tmuxPanels.value.map(({ id }) => id),
  hostMetricsPanel.value.map(({ id }) => id),
  gitReviewPanel.value.map(({ id }) => id),
]);
const dockviewHost = ref<HTMLElement | null>(null);
const tmuxLauncher = useTmuxMonitorLauncher();
const browserDialogOpen = ref(false);
const toolCatalog = computed(() =>
  createWorkspaceToolCatalog({
    canOpenFiles: fileWorkspaceAvailable.value,
    canOpenGitReview:
      workspaceActions.canOpenGitReview.value && fileWorkspaceRoot.value.trim() !== "",
    canLaunchRemoteTools: workspaceActions.canLaunch.value,
    canOpenBrowser: workspaceActions.canLaunch.value || workspaceActions.isManagedRuntime.value,
    canOpenTmux: tmuxLauncher.canOpen.value,
    canMonitorHost: workspaceActions.canMonitorHost.value,
    subAgents: subAgentPanels.value.map(({ hostId, threadId, title }) => ({
      hostId,
      threadId,
      title,
    })),
    actions: {
      openFiles: workspaceActions.openFiles,
      openGitReview: workspaceActions.openGitReview,
      openTerminal: workspaceActions.openTerminal,
      openBrowser: () => {
        if (workspaceActions.isManagedRuntime.value) workspaceActions.openRuntimeBrowser();
        else browserDialogOpen.value = true;
      },
      openSubAgent: (subAgent) => {
        void threadView.openSubAgentPanel({
          ...subAgent,
          parentHostId: workspace.selectedHostId.value,
          parentThreadId: workspace.selectedThreadId.value,
        });
      },
      openTmux: tmuxLauncher.open,
      openHostMetrics: workspaceActions.openHostMonitor,
    },
  }),
);

function showPanel(panelId: string) {
  if (props.layout === "mobile") {
    mobileToolsOpen.value = panelId !== AGENT_WORKSPACE_PANEL_ID;
    return;
  }
  if (panelId !== AGENT_WORKSPACE_PANEL_ID) {
    workspaceLayout.setToolSidebarOpen(scopeKey.value, true);
  }
}

function toggleToolSidebar() {
  if (props.layout === "mobile") {
    mobileToolsOpen.value = !mobileToolsOpen.value;
    return;
  }
  workspaceLayout.setToolSidebarOpen(scopeKey.value, !toolSidebarOpen.value);
}

const lifecycle = useWorkspaceDockLifecycle({
  scopeKey,
  host: dockviewHost,
  fileRequestScopeKey,
  reconcile: panels.reconcile,
  defaultLayout: panels.defaultLayout,
  syncGroupVisibility: panels.syncGroupVisibility,
  showPanel,
  toolSidebarOpen,
  panelIds,
});
const dockTheme = computed(() => (isDark.value ? themeDark : themeLight));

provide(WORKSPACE_FILES_PANEL_CONTEXT, {
  layout: refs.layout,
  selectedThreadId: workspace.selectedThreadId,
  workspaceThreadId: fileThreadId,
  selectedProjectId: workspace.selectedProjectId,
  selectedHostId: workspace.selectedHostId,
  rootPath: fileWorkspaceRoot,
});
provide(WORKSPACE_DOCK_UI_CONTEXT, {
  layout: refs.layout,
  toolCatalog,
  toolSidebarOpen,
  toggleToolSidebar,
  closePanel: panels.closeDynamic,
});
</script>

<template>
  <div
    data-testid="workspace-dock-frame"
    class="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden"
  >
    <MobileWorkspaceHeader
      v-if="layout === 'mobile'"
      :tools-open="toolSidebarOpen"
      @toggle-tools="toggleToolSidebar"
    >
      <template #start><slot name="mobile-header-start" :tools-open="toolSidebarOpen" /></template>
    </MobileWorkspaceHeader>
    <!--
      h-0 + flex-1 gives the Dockview host a definite remaining height. Keeping an auto height here
      lets a restored grid contribute its stale intrinsic height during a keyed thread switch,
      which can shorten the whole workspace even though every panel agrees with its host.
    -->
    <div ref="dockviewHost" class="gateway-dockview h-0 min-h-0 w-full flex-1 overflow-hidden">
      <DockviewVue
        class="h-full w-full"
        :right-header-actions-component="
          layout === 'desktop' ? 'WorkspaceDockGroupActions' : undefined
        "
        left-header-actions-component="WorkspaceDockToolHeaderActions"
        :theme="dockTheme"
        floating-group-bounds="boundedWithinViewport"
        :disable-floating-groups="layout === 'mobile'"
        :locked="layout === 'mobile'"
        @ready="lifecycle.ready"
      />
    </div>
    <BrowserOpenDialog
      v-model:open="browserDialogOpen"
      :open-target="workspaceActions.openBrowser"
    />
  </div>
</template>

<style scoped>
.gateway-dockview {
  --gateway-dock-tab-width: clamp(14rem, 18vw, 20rem);
  --dv-background-color: var(--surface);
  --dv-paneview-active-outline-color: transparent;
  --dv-tabs-and-actions-container-background-color: var(--surface);
  --dv-activegroup-visiblepanel-tab-background-color: var(--canvas-soft);
  --dv-activegroup-hiddenpanel-tab-background-color: var(--surface);
  --dv-inactivegroup-visiblepanel-tab-background-color: var(--canvas-soft);
  --dv-inactivegroup-hiddenpanel-tab-background-color: var(--surface);
  --dv-tab-divider-color: var(--hairline);
  --dv-separator-border: var(--hairline);
  --dv-active-sash-color: var(--hairline);
  --dv-tabs-and-actions-container-height: 2rem;
}

.gateway-dockview :deep(.dv-tabs-and-actions-container) {
  height: 2rem;
  min-height: 2rem;
  border-bottom: 1px solid var(--hairline);
}

.gateway-dockview :deep(.dv-tab) {
  margin: 0;
  padding-inline: 0.125rem;
  border-radius: 9999px;
  background-color: transparent !important;
}

.gateway-dockview :deep(.dv-tab.dv-active-tab) {
  background-color: var(--canvas-soft) !important;
}

.gateway-dockview :deep(.dv-tab.dv-inactive-tab:hover) {
  background-color: var(--canvas-soft) !important;
}

/* The Agent title is the conversation header, so it shares the full-width strip with the content
   below instead of reading as a separate floating tab. Tool tabs keep their compact pill treatment. */
.gateway-dockview :deep(.dv-tab:has([data-panel-kind="agent"])) {
  border-radius: 0;
  background-color: transparent !important;
}

/* Keep the Agent, sub-agent, and tool tabs visually aligned. Dockview sizes tabs from their
   content by default, which makes a short tool label look disproportionately narrow beside the
   Agent tab. A responsive basis gives the default tab a little more breathing room without making
   the tab strip consume the entire viewport on smaller screens. */
.gateway-dockview :deep(.dv-tabs-container.dv-horizontal > .dv-tab) {
  flex: 0 0 var(--gateway-dock-tab-width);
  width: var(--gateway-dock-tab-width) !important;
  min-width: var(--gateway-dock-tab-width) !important;
  max-width: var(--gateway-dock-tab-width) !important;
}

.gateway-dockview :deep(.dv-tab:has([data-panel-kind="toolHome"])) {
  display: none;
}

.gateway-dockview :deep(.dv-groupview:has([data-panel-kind="agent"]) .dv-tab) {
  background: transparent;
}

@media (max-width: 48rem) {
  .gateway-dockview {
    --gateway-dock-tab-width: 12rem;
  }
}
</style>
