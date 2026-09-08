import { Orientation, type SerializedDockview } from "dockview-vue";
import {
  AGENT_WORKSPACE_PANEL_ID,
  TOOL_HOME_WORKSPACE_PANEL_ID,
} from "@/stores/gateway/workspace-panels";
import type { WorkspaceDockPanelParams, WorkspacePanelKind } from "./types";

export const AGENT_WORKSPACE_GROUP_ID = "workspace-agent-group";
export const TOOLS_WORKSPACE_GROUP_ID = "workspace-tools-group";

export interface WorkspacePanelDefinition {
  id: string;
  title: string;
  component: string;
  params: WorkspaceDockPanelParams;
}

export function workspacePanelGroup(kind: WorkspacePanelKind): "agent" | "tools" {
  return kind === "agent" ? "agent" : "tools";
}

export function buildWorkspaceDefaultLayout(
  definitions: WorkspacePanelDefinition[],
  width: number,
  height: number,
): SerializedDockview {
  const agentPanels = definitions.filter(
    ({ params }) => workspacePanelGroup(params.kind) === "agent",
  );
  const toolPanels = definitions.filter(
    ({ params }) => workspacePanelGroup(params.kind) === "tools",
  );
  const agentWidth = Math.round(width * 0.6);
  const toolWidth = Math.max(0, width - agentWidth);

  return {
    grid: {
      root: {
        type: "branch",
        size: height,
        data: [
          {
            type: "leaf",
            size: agentWidth,
            data: {
              id: AGENT_WORKSPACE_GROUP_ID,
              views: agentPanels.map(({ id }) => id),
              activeView: agentPanels.find(({ id }) => id === AGENT_WORKSPACE_PANEL_ID)?.id,
              locked: "no-drop-target",
            },
          },
          {
            type: "leaf",
            size: toolWidth,
            data: {
              id: TOOLS_WORKSPACE_GROUP_ID,
              views: toolPanels.map(({ id }) => id),
              activeView:
                toolPanels.find(({ id }) => id === TOOL_HOME_WORKSPACE_PANEL_ID)?.id ??
                toolPanels[0]?.id,
              locked: "no-drop-target",
            },
          },
        ],
      },
      width,
      height,
      orientation: Orientation.HORIZONTAL,
    },
    panels: Object.fromEntries(
      definitions.map((definition) => [
        definition.id,
        {
          id: definition.id,
          contentComponent: definition.component,
          tabComponent: "WorkspaceDockTab",
          title: definition.title,
          renderer: "always",
          params: definition.params,
        },
      ]),
    ),
    activeGroup: AGENT_WORKSPACE_GROUP_ID,
  };
}
