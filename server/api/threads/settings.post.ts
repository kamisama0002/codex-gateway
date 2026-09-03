import { readValidatedBody } from "h3";
import { threadBroker } from "../../utils/gateway/runtime/broker";
import { defineGatewayEventHandler } from "../../utils/gateway/http/errors";
import { requireWorkspaceHost } from "../../utils/gateway/runtime-manager/local-workspace";
import { threadSettingsUpdateSchema } from "../../utils/gateway/http/validation/threads";

export default defineGatewayEventHandler(async (event) => {
  const input = await readValidatedBody(event, (body) => threadSettingsUpdateSchema.parse(body));
  const host = await requireWorkspaceHost(input.hostId);
  return threadBroker.updateThreadSettings(host, input.threadId, {
    model: input.model,
    effort: input.effort,
    approvalPolicy: input.approvalPolicy,
    collaborationMode: input.collaborationMode,
  });
});
