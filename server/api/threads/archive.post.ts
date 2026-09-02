import { createError, readValidatedBody } from "h3";
import { threadBroker } from "../../utils/gateway/runtime/broker";
import { userConfigMutationService } from "../../utils/gateway/config/user-config-mutation-service";
import { defineGatewayEventHandler } from "../../utils/gateway/http/errors";
import { requireWorkspaceHost } from "../../utils/gateway/runtime-manager/local-workspace";
import { threadLifecycleSchema } from "../../utils/gateway/http/validation/threads";
import { ThreadRolloutNotReadyError } from "../../utils/gateway/runtime/thread-lifecycle";

export default defineGatewayEventHandler(async (event) => {
  const input = await readValidatedBody(event, (body) => threadLifecycleSchema.parse(body));
  const host = await requireWorkspaceHost(input.hostId);
  const userId = event.context.auth!.user.id;
  try {
    await threadBroker.archiveThread(host, input.threadId, userId);
  } catch (error: unknown) {
    if (error instanceof ThreadRolloutNotReadyError) {
      throw createError({
        statusCode: 409,
        statusMessage: "thread_rollout_not_ready",
        data: { code: "thread_rollout_not_ready" },
      });
    }
    throw error;
  }
  userConfigMutationService.unpinThread(userId, host.id, input.threadId);
  return { ok: true };
});
