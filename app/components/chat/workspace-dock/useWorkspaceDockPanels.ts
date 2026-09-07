import type { ComputedRef, Ref } from "vue";
import type { DockviewApi, DockviewGroupPanel, IDockviewPanel } from "dockview-vue";
import { useGatewayTerminalTransport } from "@/composables/terminal/useGatewayTerminalTransport";
import { useGatewayThreadViewStore } from "@/stores/gateway-thread-view";
import { useGatewayWorkspaceLayoutStore } from "@/stores/gateway-workspace-layout";
import { useGatewayBrowserStore } from "@/stores/gateway-browser";
import { useGatewayTmuxStore } from "@/stores/gateway-tmux";
import { closeBrowserPreview } from "@/stores/gateway-browser/transport";
import {
  AGENT_WORKSPACE_PANEL_ID,
  FILES_WORKSPACE_PANEL_ID,
  TOOL_HOME_WORKSPACE_PANEL_ID,
} from "@/stores/gateway/workspace-panels";
import { workspaceDockPanelParamsFromUnknown } from "./types";
import { workspacePanelPolicy } from "./panel-registry";
import { useGatewayHostMetricsPanelStore } from "@/stores/gateway-host-metrics/panels";
import { useFileGitReviewPanelStore } from "@/stores/file-workspace/git/review-panel";
import {
  AGENT_WORKSPACE_GROUP_ID,
  TOOLS_WORKSPACE_GROUP_ID,
  buildWorkspaceDefaultLayout,
  workspacePanelGroup,
  type WorkspacePanelDefinition,
} from "./workspace-layout";

export function useWorkspaceDockPanels(options: {
  layout: Ref<"desktop" | "mobile">;
  selectedThreadId: Ref<string | null>;
  filesPanelOpen: ComputedRef<boolean>;
  toolSidebarOpen: ComputedRef<boolean>;
  terminalPanels: ComputedRef<Array<{ id: string; session: { sessionId: string; title: string } }>>;
  subAgentPanels: ComputedRef<
    Array<{ id: string; hostId: number; threadId: string; title: string }>
  >;
  browserPanels: ComputedRef<Array<{ id: string; panel: { panelId: string; title: string } }>>;
  tmuxPanels: ComputedRef<Array<{ id: string }>>;
  hostMetricsPanel: ComputedRef<Array<{ id: string; hostId: number }>>;
  gitReviewPanel: ComputedRef<Array<{ id: string }>>;
  scopeKey: ComputedRef<string>;
}) {
  const { t } = useI18n();
  const threadView = useGatewayThreadViewStore();
  const workspaceLayout = useGatewayWorkspaceLayoutStore();
  const terminalTransport = useGatewayTerminalTransport();
  const browserStore = useGatewayBrowserStore();
  const tmuxStore = useGatewayTmuxStore();
  const hostMetricsPanels = useGatewayHostMetricsPanelStore();
  const gitReviewPanels = useFileGitReviewPanelStore();

  function definitions(): WorkspacePanelDefinition[] {
    const panels: WorkspacePanelDefinition[] = [
      {
        id: AGENT_WORKSPACE_PANEL_ID,
        title: t("app.agentTab"),
        component: workspacePanelPolicy("agent").component,
        params: { kind: "agent" },
      },
      {
        id: TOOL_HOME_WORKSPACE_PANEL_ID,
        title: t("app.workspaceTools"),
        component: workspacePanelPolicy("toolHome").component,
        params: { kind: "toolHome" },
      },
    ];
    if (options.selectedThreadId.value !== null && options.filesPanelOpen.value) {
      panels.push({
        id: FILES_WORKSPACE_PANEL_ID,
        title: t("app.filesTab"),
        component: workspacePanelPolicy("files").component,
        params: { kind: "files" },
      });
    }
    panels.push(
      ...options.gitReviewPanel.value.map(({ id }) => ({
        id,
        title: t("app.fileGitReviewTab"),
        component: workspacePanelPolicy("gitReview").component,
        params: { kind: "gitReview" as const },
      })),
      ...options.terminalPanels.value.map(({ id, session }) => ({
        id,
        title: session.title,
        component: workspacePanelPolicy("terminal").component,
        params: { kind: "terminal" as const, sessionId: session.sessionId },
      })),
      ...options.subAgentPanels.value.map(({ id, hostId, threadId, title }) => ({
        id,
        title,
        component: workspacePanelPolicy("subagent").component,
        params: { kind: "subagent" as const, subAgentHostId: hostId, subAgentThreadId: threadId },
      })),
      ...options.browserPanels.value.map(({ id, panel }) => ({
        id,
        title: panel.title,
        component: workspacePanelPolicy("browser").component,
        params: { kind: "browser" as const, browserPanelId: panel.panelId },
      })),
      ...options.tmuxPanels.value.map(({ id }) => ({
        id,
        title: t("app.tmuxMonitors"),
        component: workspacePanelPolicy("tmux").component,
        params: { kind: "tmux" as const },
      })),
      ...options.hostMetricsPanel.value.map(({ id, hostId }) => ({
        id,
        title: t("app.hostMonitor"),
        component: workspacePanelPolicy("hostMetrics").component,
        params: { kind: "hostMetrics" as const, hostId },
      })),
    );
    return panels;
  }

  function reconcile(api: DockviewApi) {
    const desired = definitions();
    const desiredIds = new Set(desired.map(({ id }) => id));
    for (const panel of api.panels) {
      if (!desiredIds.has(panel.id)) removeUnexpectedPanel(api, panel);
    }

    const groups = ensureFixedGroups(api);
    for (const definition of desired) {
      const targetGroup =
        workspacePanelGroup(definition.params.kind) === "agent" ? groups.agent : groups.tools;
      const existing = api.getPanel(definition.id);
      if (existing !== undefined) {
        existing.api.setTitle(definition.title);
        existing.api.updateParameters(definition.params);
        if (existing.api.group.id !== targetGroup.id) {
          existing.api.moveTo({ group: targetGroup });
        }
      } else {
        api.addPanel({
          ...definition,
          tabComponent: "WorkspaceDockTab",
          renderer: "always",
          inactive: definition.id !== AGENT_WORKSPACE_PANEL_ID,
          position: { referenceGroup: targetGroup },
        });
      }
    }
    groups.agent.locked = "no-drop-target";
    groups.tools.locked = "no-drop-target";
    syncGroupVisibility(api);
  }

  function defaultLayout(api: DockviewApi) {
    return buildWorkspaceDefaultLayout(definitions(), api.width, api.height);
  }

  function syncGroupVisibility(api: DockviewApi) {
    const agentGroup = fixedGroup(api, AGENT_WORKSPACE_GROUP_ID);
    const toolsGroup = fixedGroup(api, TOOLS_WORKSPACE_GROUP_ID);
    if (!agentGroup || !toolsGroup) return;
    const toolsVisible = options.toolSidebarOpen.value;
    const agentVisible = options.layout.value === "desktop" || !toolsVisible;
    if (agentGroup.api.isVisible !== agentVisible) agentGroup.api.setVisible(agentVisible);
    if (toolsGroup.api.isVisible !== toolsVisible) toolsGroup.api.setVisible(toolsVisible);
  }

  function closeDynamic(panel: IDockviewPanel) {
    const params = workspaceDockPanelParamsFromUnknown(panel.params);
    if (params === null) return;
    const nextPanelId = activateNextPanel(panel);
    switch (params.kind) {
      case "files":
        workspaceLayout.setFilesPanelOpen(options.scopeKey.value, false);
        break;
      case "terminal":
        void terminalTransport.closeTerminal(params.sessionId);
        break;
      case "subagent":
        threadView.closeSubAgentPanel({
          hostId: params.subAgentHostId,
          threadId: params.subAgentThreadId,
        });
        break;
      case "browser": {
        const removed = browserStore.removePanel(params.browserPanelId);
        if (removed.sessionId !== null && removed.sessionId !== undefined) {
          void closeBrowserPreview(removed.sessionId);
        }
        break;
      }
      case "tmux":
        tmuxStore.closePanel();
        break;
      case "hostMetrics":
        hostMetricsPanels.close(options.scopeKey.value);
        break;
      case "gitReview":
        gitReviewPanels.close(options.scopeKey.value);
        break;
      case "agent":
      case "toolHome":
        return;
    }
    if (nextPanelId !== null) workspaceLayout.requestPanelActivation(nextPanelId);
  }

  function activateNextPanel(closingPanel: IDockviewPanel) {
    const remainingTool = closingPanel.api.group.panels.find((panel) => {
      if (panel.id === closingPanel.id) return false;
      return workspaceDockPanelParamsFromUnknown(panel.params)?.kind !== "toolHome";
    });
    const nextPanel =
      remainingTool ??
      closingPanel.api.group.panels.find(({ id }) => id === TOOL_HOME_WORKSPACE_PANEL_ID) ??
      closingPanel.api.group.panels.find(({ id }) => id === AGENT_WORKSPACE_PANEL_ID);
    nextPanel?.api.setActive();
    return nextPanel?.id ?? null;
  }

  function removeUnexpectedPanel(api: DockviewApi, panel: IDockviewPanel) {
    const params = workspaceDockPanelParamsFromUnknown(panel.params);
    if (params?.kind === "browser") {
      const session = browserStore.sessionForPanel(params.browserPanelId);
      if (session !== null) void closeBrowserPreview(session.sessionId);
    }
    api.removePanel(panel);
  }

  return { reconcile, defaultLayout, syncGroupVisibility, closeDynamic };
}

function ensureFixedGroups(api: DockviewApi) {
  let agent = fixedGroup(api, AGENT_WORKSPACE_GROUP_ID);
  if (!agent) {
    const reference = api.groups.find((group) => group.api.location.type === "grid");
    agent = reference
      ? api.addGroup({
          id: AGENT_WORKSPACE_GROUP_ID,
          referenceGroup: reference,
          direction: "left",
          locked: "no-drop-target",
          skipSetActive: true,
        })
      : api.addGroup({
          id: AGENT_WORKSPACE_GROUP_ID,
          direction: "left",
          locked: "no-drop-target",
          skipSetActive: true,
        });
  }

  let tools = fixedGroup(api, TOOLS_WORKSPACE_GROUP_ID);
  if (!tools) {
    tools = api.addGroup({
      id: TOOLS_WORKSPACE_GROUP_ID,
      referenceGroup: agent,
      direction: "right",
      initialWidth: Math.round(api.width * 0.4),
      locked: "no-drop-target",
      skipSetActive: true,
    });
  }
  return { agent, tools };
}

function fixedGroup(api: DockviewApi, id: string): DockviewGroupPanel | undefined {
  return api.groups.find((group) => group.id === id);
}
