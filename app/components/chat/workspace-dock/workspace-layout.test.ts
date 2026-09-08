import { describe, expect, it } from "vitest";
import {
  AGENT_WORKSPACE_GROUP_ID,
  TOOLS_WORKSPACE_GROUP_ID,
  buildWorkspaceDefaultLayout,
  workspacePanelGroup,
  type WorkspacePanelDefinition,
} from "./workspace-layout";

describe("workspace dock layout policy", () => {
  it("keeps Agent in the primary group and every auxiliary panel in tools", () => {
    expect(workspacePanelGroup("agent")).toBe("agent");

    for (const kind of [
      "toolHome",
      "files",
      "gitReview",
      "terminal",
      "subagent",
      "browser",
      "tmux",
      "hostMetrics",
    ] as const) {
      expect(workspacePanelGroup(kind)).toBe("tools");
    }
  });

  it("builds a persistent sixty-forty Agent and tools split", () => {
    const definitions: WorkspacePanelDefinition[] = [
      {
        id: "agent",
        title: "Agent",
        component: "WorkspaceDockAgentPanel",
        params: { kind: "agent" },
      },
      {
        id: "tool-home",
        title: "Tools",
        component: "WorkspaceDockToolHomePanel",
        params: { kind: "toolHome" },
      },
      {
        id: "files",
        title: "Files",
        component: "WorkspaceDockFilesPanel",
        params: { kind: "files" },
      },
    ];

    const layout = buildWorkspaceDefaultLayout(definitions, 1000, 700);

    expect(layout.grid).toMatchObject({
      width: 1000,
      height: 700,
      root: {
        type: "branch",
        size: 700,
        data: [
          {
            type: "leaf",
            size: 600,
            data: {
              id: AGENT_WORKSPACE_GROUP_ID,
              views: ["agent"],
              activeView: "agent",
            },
          },
          {
            type: "leaf",
            size: 400,
            data: {
              id: TOOLS_WORKSPACE_GROUP_ID,
              views: ["tool-home", "files"],
              activeView: "tool-home",
            },
          },
        ],
      },
    });
    expect(layout.panels.agent?.renderer).toBe("always");
    expect(layout.panels["tool-home"]?.renderer).toBe("always");
    expect(layout.activeGroup).toBe(AGENT_WORKSPACE_GROUP_ID);
  });
});
