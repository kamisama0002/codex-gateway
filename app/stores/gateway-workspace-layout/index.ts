import type { SerializedDockview } from "dockview-vue";
import { defineStore, skipHydrate } from "pinia";
import { ref } from "vue";
import { useAccountLocalStorage } from "@/composables/storage/useAccountLocalStorage";
import { AGENT_WORKSPACE_PANEL_ID } from "../gateway/workspace-panels";

export const useGatewayWorkspaceLayoutStore = defineStore("gateway-workspace-layout", () => {
  const layoutsByScope = useAccountLocalStorage<Record<string, SerializedDockview>>(
    "workspace-layouts",
    {},
  );
  const activePanelByScope = useAccountLocalStorage<Record<string, string>>(
    "workspace-active-panels",
    {},
  );
  const toolSidebarOpenByScope = useAccountLocalStorage<Record<string, boolean>>(
    "workspace-tool-sidebar-open",
    {},
  );
  const filesPanelOpenByScope = useAccountLocalStorage<Record<string, boolean>>(
    "workspace-files-panel-open",
    {},
  );
  const panelActivationRequest = ref<{ panelId: string; sequence: number } | null>(null);

  const layoutFor = (scopeKey: string) => layoutsByScope.value[scopeKey] ?? null;
  const activePanelFor = (scopeKey: string) =>
    activePanelByScope.value[scopeKey] ?? AGENT_WORKSPACE_PANEL_ID;
  const isToolSidebarOpen = (scopeKey: string) => toolSidebarOpenByScope.value[scopeKey] ?? true;
  const isFilesPanelOpen = (scopeKey: string) => filesPanelOpenByScope.value[scopeKey] === true;
  const hasFilesPanelPreference = (scopeKey: string) =>
    Object.prototype.hasOwnProperty.call(filesPanelOpenByScope.value, scopeKey);

  function saveLayout(scopeKey: string, layout: SerializedDockview) {
    layoutsByScope.value = { ...layoutsByScope.value, [scopeKey]: layout };
  }

  function setActivePanel(scopeKey: string, panelId: string) {
    activePanelByScope.value = { ...activePanelByScope.value, [scopeKey]: panelId };
  }

  function setToolSidebarOpen(scopeKey: string, open: boolean) {
    toolSidebarOpenByScope.value = { ...toolSidebarOpenByScope.value, [scopeKey]: open };
  }

  function setFilesPanelOpen(scopeKey: string, open: boolean) {
    filesPanelOpenByScope.value = { ...filesPanelOpenByScope.value, [scopeKey]: open };
  }

  function requestPanelActivation(panelId: string) {
    panelActivationRequest.value = {
      panelId,
      sequence: (panelActivationRequest.value?.sequence ?? 0) + 1,
    };
  }

  function consumePanelActivation(sequence: number) {
    if (panelActivationRequest.value?.sequence === sequence) {
      panelActivationRequest.value = null;
    }
  }

  function resetRuntimeState() {
    panelActivationRequest.value = null;
  }

  return {
    layoutsByScope: skipHydrate(layoutsByScope),
    activePanelByScope: skipHydrate(activePanelByScope),
    toolSidebarOpenByScope: skipHydrate(toolSidebarOpenByScope),
    filesPanelOpenByScope: skipHydrate(filesPanelOpenByScope),
    panelActivationRequest,
    layoutFor,
    activePanelFor,
    isToolSidebarOpen,
    isFilesPanelOpen,
    hasFilesPanelPreference,
    saveLayout,
    setActivePanel,
    setToolSidebarOpen,
    setFilesPanelOpen,
    requestPanelActivation,
    consumePanelActivation,
    resetRuntimeState,
  };
});

export function workspaceLayoutScopeKey(
  hostId: number | null,
  projectId: number | null,
  threadId: string | null,
) {
  return `${hostId ?? "host"}:${projectId ?? "project"}:${threadId ?? "thread"}`;
}
