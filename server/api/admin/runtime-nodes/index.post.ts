import { readValidatedBody, type H3Event } from "h3";
import { requireAdminUser } from "../../../utils/gateway/auth/context";
import { defineGatewayEventHandler } from "../../../utils/gateway/http/errors";
import { runtimeNodeAdministrationService } from "../../../utils/gateway/runtime-manager/runtime-node-administration";
import { runtimeNodeAdminCreateInputSchema } from "../../../utils/gateway/runtime-manager/runtime-node-admin-types";

export async function createRuntimeNodeForEvent(
  event: H3Event,
  service: Pick<
    typeof runtimeNodeAdministrationService,
    "createNode"
  > = runtimeNodeAdministrationService,
) {
  requireAdminUser(event);
  const input =
    event.context.body === undefined
      ? await readValidatedBody(event, (body) => runtimeNodeAdminCreateInputSchema.parse(body))
      : runtimeNodeAdminCreateInputSchema.parse(event.context.body);
  return await service.createNode(input);
}

export default defineGatewayEventHandler(async (event) => await createRuntimeNodeForEvent(event));
