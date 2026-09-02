import type { RealtimeClientMessage } from "~~/shared/types";
import { remoteGitFiles } from "../../infra/host-services";
import { requireRecord } from "../../http/validation/common";
import { requireWorkspaceHost } from "../../runtime-manager/local-workspace";
import { projectStore } from "../../state/projects";
import { sendRealtimePeerMessage, type RealtimePeer } from "../peer-state";

export async function compareGitFile(
  peer: RealtimePeer,
  request: Extract<RealtimeClientMessage, { type: "file.git.compare" }>,
) {
  const host = await requireWorkspaceHost(request.hostId);
  const project = requireRecord(projectStore.get(request.projectId), "Project not found");
  if (project.hostId !== host.id) {
    throw new Error(`Project ${project.id} does not belong to host ${host.id}`);
  }
  const comparison = await remoteGitFiles.compare(host, project, request.path);
  sendRealtimePeerMessage(peer, {
    type: "file.git.comparison",
    requestId: request.requestId,
    hostId: host.id,
    projectId: project.id,
    path: request.path,
    comparison,
  });
}

export async function inspectGitWorkspace(
  peer: RealtimePeer,
  request: Extract<RealtimeClientMessage, { type: "file.git.workspace.inspect" }>,
) {
  const host = await requireWorkspaceHost(request.hostId);
  const project = requireRecord(projectStore.get(request.projectId), "Project not found");
  if (project.hostId !== host.id) {
    throw new Error(`Project ${project.id} does not belong to host ${host.id}`);
  }
  const snapshot = await remoteGitFiles.inspectWorkspace(host, project, request.rootPath);
  sendRealtimePeerMessage(peer, {
    type: "file.git.workspace.snapshot",
    requestId: request.requestId,
    hostId: host.id,
    projectId: project.id,
    rootPath: request.rootPath,
    snapshot,
  });
}
