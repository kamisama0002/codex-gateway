import type { RealtimeClientMessage } from "~~/shared/types";
import { requireRecord } from "../http/validation/common";
import { turnSteerSchema } from "../http/validation/threads";
import { threadBroker } from "../runtime/broker";
import { requireWorkspaceHost } from "../runtime-manager/local-workspace";
import { projectStore } from "../state/projects";
import {
  fileReferencesAdditionalContext,
  validateProjectFileReferences,
} from "../project-files/project-file-references";

export type RealtimeTurnSteerMessage = Extract<RealtimeClientMessage, { type: "turn.steer" }>;

export async function steerTurnFromRealtime(message: RealtimeTurnSteerMessage) {
  const input = turnSteerSchema.parse(message);
  const host = await requireWorkspaceHost(input.hostId);
  const project = requireRecord(projectStore.get(input.projectId), "Project not found");
  const references = await validateProjectFileReferences(host, project, input.references);
  return threadBroker.steerTurn(host, input.threadId, {
    text: input.text,
    expectedTurnId: input.expectedTurnId,
    clientUserMessageId: input.clientUserMessageId,
    images: input.images,
    additionalContext: fileReferencesAdditionalContext(references),
  });
}
