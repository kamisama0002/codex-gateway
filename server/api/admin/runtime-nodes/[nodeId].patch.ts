import { getRouterParam, readValidatedBody, type H3Event } from "h3";
import { requireAdminUser } from "../../../utils/gateway/auth/context";
import { defineGatewayEventHandler } from "../../../utils/gateway/http/errors";
import { runtimeNodeAdministrationService } from "../../../utils/gateway/runtime-manager/runtime-node-administration";
import { runtimeNodeAdminPatchInputSchema } from "../../../utils/gateway/runtime-manager/runtime-node-admin-types";

export async function patchRuntimeNodeForEvent(
  event: H3Event,
  service: Pick<
    typeof runtimeNodeAdministrationService,
    "patchNode"
  > = runtimeNodeAdministrationService,
) {
  requireAdminUser(event);
  const nodeId = getRouterParam(event, "nodeId")?.trim() ?? "";
  const input =
    event.context.body === undefined
      ? await readValidatedBody(event, (body) => runtimeNodeAdminPatchInputSchema.parse(body))
      : runtimeNodeAdminPatchInputSchema.parse(event.context.body);
  return await service.patchNode(nodeId, input);
}

export default defineGatewayEventHandler(async (event) => await patchRuntimeNodeForEvent(event));
