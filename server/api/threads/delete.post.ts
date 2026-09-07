import { readValidatedBody } from "h3";
import { threadBroker } from "../../utils/gateway/runtime/broker";
import { userConfigMutationService } from "../../utils/gateway/config/user-config-mutation-service";
import { defineGatewayEventHandler } from "../../utils/gateway/http/errors";
import { withUserConfigLock } from "../../utils/gateway/http/config-mutation";
import { requireWorkspaceHost } from "../../utils/gateway/runtime-manager/local-workspace";
import { threadLifecycleSchema } from "../../utils/gateway/http/validation/threads";

export default defineGatewayEventHandler(async (event) => {
  const input = await readValidatedBody(event, (body) => threadLifecycleSchema.parse(body));
  const host = await requireWorkspaceHost(input.hostId);
  const userId = event.context.auth!.user.id;
  return await withUserConfigLock(userId, async () => {
    await threadBroker.deleteThread(host, input.threadId, userId);
    await userConfigMutationService.unpinThread(userId, host.id, input.threadId);
    return { ok: true };
  });
});
