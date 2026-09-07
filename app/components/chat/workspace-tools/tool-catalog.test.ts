import { describe, expect, it, vi } from "vitest";
import { createWorkspaceToolCatalog, type WorkspaceToolCatalogActions } from "./tool-catalog";

describe("workspace tool catalog", () => {
  it("keeps stable tool order and targets every real sub-agent instance", () => {
    const actions = createActions();
    const catalog = createWorkspaceToolCatalog({
      canOpenThreadTools: true,
      canLaunchRemoteTools: true,
      canOpenTmux: true,
      canMonitorHost: true,
      subAgents: [
        { hostId: 1, threadId: "a", title: "Atlas" },
        { hostId: 1, threadId: "b", title: "Nova" },
      ],
      actions,
    });

    expect(catalog.map(({ id }) => id)).toEqual([
      "files",
      "gitReview",
      "terminal",
      "browser",
      "subagent:1:a",
      "subagent:1:b",
      "tmux",
      "hostMetrics",
    ]);

    for (const item of catalog) item.activate();

    expect(actions.openFiles).toHaveBeenCalledOnce();
    expect(actions.openGitReview).toHaveBeenCalledOnce();
    expect(actions.openTerminal).toHaveBeenCalledOnce();
    expect(actions.openBrowser).toHaveBeenCalledOnce();
    expect(actions.openSubAgent).toHaveBeenNthCalledWith(1, {
      hostId: 1,
      threadId: "a",
      title: "Atlas",
    });
    expect(actions.openSubAgent).toHaveBeenNthCalledWith(2, {
      hostId: 1,
      threadId: "b",
      title: "Nova",
    });
    expect(actions.openTmux).toHaveBeenCalledOnce();
    expect(actions.openHostMetrics).toHaveBeenCalledOnce();
  });

  it("shows unavailable categories without dispatching their actions", () => {
    const actions = createActions();
    const catalog = createWorkspaceToolCatalog({
      canOpenThreadTools: false,
      canLaunchRemoteTools: false,
      canOpenTmux: false,
      canMonitorHost: false,
      subAgents: [],
      actions,
    });

    expect(catalog.map(({ id }) => id)).toEqual([
      "files",
      "gitReview",
      "terminal",
      "browser",
      "subagent",
      "tmux",
      "hostMetrics",
    ]);
    expect(catalog.every(({ disabled }) => disabled)).toBe(true);

    for (const item of catalog) item.activate();

    for (const action of Object.values(actions)) expect(action).not.toHaveBeenCalled();
  });
});

function createActions(): WorkspaceToolCatalogActions {
  return {
    openFiles: vi.fn(),
    openGitReview: vi.fn(),
    openTerminal: vi.fn(),
    openBrowser: vi.fn(),
    openSubAgent: vi.fn(),
    openTmux: vi.fn(),
    openHostMetrics: vi.fn(),
  };
}
