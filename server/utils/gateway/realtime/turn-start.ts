import type { RealtimeClientMessage } from "~~/shared/types";
import { requireRecord } from "../http/validation/common";
import { turnStartSchema } from "../http/validation/threads";
import { threadBroker } from "../runtime/broker";
import { requireWorkspaceHost } from "../runtime-manager/local-workspace";
import { projectStore } from "../state/projects";
import { currentGatewayUserId } from "../state/memory";
import { automaticThreadTitleService } from "../thread-titles/service";
import {
  fileReferencesAdditionalContext,
  validateProjectFileReferences,
} from "../project-files/project-file-references";

export type RealtimeTurnStartMessage = Extract<RealtimeClientMessage, { type: "turn.start" }>;

export async function startTurnFromRealtime(message: RealtimeTurnStartMessage) {
  const input = turnStartSchema.parse(message);
  const host = await requireWorkspaceHost(input.hostId);
  const userId = currentGatewayUserId();
  if (userId === null) throw new Error("Turn start requires an authenticated user scope");
  const project = requireRecord(projectStore.get(input.projectId), "Project not found");
  const references = await validateProjectFileReferences(host, project, input.references);
  const titleCandidate = automaticThreadTitleService.prepare({
    userId,
    host,
    threadId: input.threadId,
    message: input.text,
    model: input.model,
  });
  const result = await threadBroker.startTurn(host, input.threadId, {
    text: input.text,
    cwd: project.remotePath,
    clientUserMessageId: input.clientUserMessageId,
    model: input.model,
    effort: input.effort,
    approvalPolicy: input.approvalPolicy,
    collaborationMode: input.collaborationMode,
    images: input.images,
    files: input.files,
    additionalContext: fileReferencesAdditionalContext(references),
  });
  if (titleCandidate !== null) void automaticThreadTitleService.start(titleCandidate);
  return result;
}
