export interface WorkspaceSubAgentTool {
  hostId: number;
  threadId: string;
  title: string;
}

export interface WorkspaceToolCatalogActions {
  openFiles: () => void;
  openGitReview: () => void;
  openTerminal: () => void;
  openBrowser: () => void;
  openSubAgent: (subAgent: WorkspaceSubAgentTool) => void;
  openTmux: () => void;
  openHostMetrics: () => void;
}

export interface WorkspaceToolCatalogInput {
  canOpenFiles: boolean;
  canOpenGitReview: boolean;
  canLaunchRemoteTools: boolean;
  terminalUnavailableReasonKey?: string;
  canOpenBrowser?: boolean;
  canOpenTmux: boolean;
  canMonitorHost: boolean;
  subAgents: WorkspaceSubAgentTool[];
  actions: WorkspaceToolCatalogActions;
}

export interface WorkspaceToolCatalogItem {
  id: string;
  kind: "files" | "gitReview" | "terminal" | "browser" | "subagent" | "tmux" | "hostMetrics";
  labelKey: string;
  label?: string;
  descriptionKey: string;
  unavailableReasonKey?: string;
  disabled: boolean;
  activate: () => void;
}

export function createWorkspaceToolCatalog(
  input: WorkspaceToolCatalogInput,
): WorkspaceToolCatalogItem[] {
  const filesUnavailable = input.canOpenFiles ? undefined : "app.workspaceToolUnavailableWorkspace";
  const gitUnavailable = input.canOpenGitReview ? undefined : "app.workspaceToolUnavailableThread";
  const remoteUnavailable = input.canLaunchRemoteTools
    ? undefined
    : "app.workspaceToolUnavailableRemote";
  const terminalUnavailable = input.canLaunchRemoteTools
    ? undefined
    : (input.terminalUnavailableReasonKey ?? remoteUnavailable);
  const browserUnavailable =
    (input.canOpenBrowser ?? input.canLaunchRemoteTools)
      ? undefined
      : "app.workspaceToolUnavailableRemote";
  const items: WorkspaceToolCatalogItem[] = [
    item({
      id: "files",
      kind: "files",
      labelKey: "app.filesTab",
      descriptionKey: "app.workspaceToolFilesDescription",
      unavailableReasonKey: filesUnavailable,
      action: input.actions.openFiles,
    }),
    item({
      id: "gitReview",
      kind: "gitReview",
      labelKey: "app.fileGitReviewTab",
      descriptionKey: "app.workspaceToolGitDescription",
      unavailableReasonKey: gitUnavailable,
      action: input.actions.openGitReview,
    }),
    item({
      id: "terminal",
      kind: "terminal",
      labelKey: "app.openTerminal",
      descriptionKey: "app.workspaceToolTerminalDescription",
      unavailableReasonKey: terminalUnavailable,
      action: input.actions.openTerminal,
    }),
    item({
      id: "browser",
      kind: "browser",
      labelKey: "app.openBrowser",
      descriptionKey: "app.workspaceToolBrowserDescription",
      unavailableReasonKey: browserUnavailable,
      action: input.actions.openBrowser,
    }),
  ];

  if (input.subAgents.length === 0) {
    items.push(
      item({
        id: "subagent",
        kind: "subagent",
        labelKey: "app.subAgentPanel",
        descriptionKey: "app.workspaceToolSubAgentDescription",
        unavailableReasonKey: "app.workspaceToolUnavailableSubAgent",
        action: () => undefined,
      }),
    );
  } else {
    items.push(
      ...input.subAgents.map((subAgent) =>
        item({
          id: `subagent:${subAgent.hostId}:${subAgent.threadId}`,
          kind: "subagent",
          labelKey: "app.subAgentPanel",
          label: subAgent.title,
          descriptionKey: "app.workspaceToolSubAgentDescription",
          action: () => input.actions.openSubAgent(subAgent),
        }),
      ),
    );
  }

  items.push(
    item({
      id: "tmux",
      kind: "tmux",
      labelKey: "app.tmuxMonitors",
      descriptionKey: "app.workspaceToolTmuxDescription",
      unavailableReasonKey: input.canOpenTmux ? undefined : "app.workspaceToolUnavailableTmux",
      action: input.actions.openTmux,
    }),
    item({
      id: "hostMetrics",
      kind: "hostMetrics",
      labelKey: "app.hostMonitor",
      descriptionKey: "app.workspaceToolMetricsDescription",
      unavailableReasonKey: input.canMonitorHost ? undefined : "app.workspaceToolUnavailableHost",
      action: input.actions.openHostMetrics,
    }),
  );

  return items;
}

function item(
  input: Omit<WorkspaceToolCatalogItem, "disabled" | "activate"> & { action: () => void },
): WorkspaceToolCatalogItem {
  const disabled = input.unavailableReasonKey !== undefined;
  return {
    id: input.id,
    kind: input.kind,
    labelKey: input.labelKey,
    label: input.label,
    descriptionKey: input.descriptionKey,
    unavailableReasonKey: input.unavailableReasonKey,
    disabled,
    activate: () => {
      if (!disabled) input.action();
    },
  };
}
