import { readValidatedBody } from "h3";
import { threadBroker } from "../../utils/gateway/runtime/broker";
import { defineGatewayEventHandler } from "../../utils/gateway/http/errors";
import { requireWorkspaceHost } from "../../utils/gateway/runtime-manager/local-workspace";
import { threadRenameSchema } from "../../utils/gateway/http/validation/threads";
import { automaticThreadTitleService } from "../../utils/gateway/thread-titles/service";
import { projectThreadTitle } from "../../utils/gateway/thread-titles/projection";

export default defineGatewayEventHandler(async (event) => {
  const input = await readValidatedBody(event, (body) => threadRenameSchema.parse(body));
  const host = await requireWorkspaceHost(input.hostId);
  const userId = event.context.auth!.user.id;
  automaticThreadTitleService.cancel(userId, input.hostId, input.threadId);
  await threadBroker.renameThread(host, input.threadId, input.name);
  projectThreadTitle(userId, input.hostId, input.threadId, input.name);
  return { ok: true };
});
