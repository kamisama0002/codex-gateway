import { readValidatedBody } from "h3";
import { threadBroker } from "../../utils/gateway/runtime/broker";
import { defineGatewayEventHandler } from "../../utils/gateway/http/errors";
import { requireRecord } from "../../utils/gateway/http/validation/common";
import { threadLifecycleSchema } from "../../utils/gateway/http/validation/threads";
import { hostStore } from "../../utils/gateway/state/hosts";

export default defineGatewayEventHandler(async (event) => {
  const input = await readValidatedBody(event, (body) => threadLifecycleSchema.parse(body));
  const host = requireRecord(hostStore.getWithSecret(input.hostId), "Host not found");
  const userId = event.context.auth!.user.id;
  const thread = await threadBroker.unarchiveThread(host, input.threadId, userId);
  return { thread };
});
