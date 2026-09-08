import { getRouterParam, type H3Event } from "h3";
import { requireAdminUser } from "../../../../utils/gateway/auth/context";
import { defineGatewayEventHandler } from "../../../../utils/gateway/http/errors";
import { runtimeNodeAdministrationService } from "../../../../utils/gateway/runtime-manager/runtime-node-administration";

export async function probeRuntimeNodeForEvent(
  event: H3Event,
  service: Pick<
    typeof runtimeNodeAdministrationService,
    "probeNode"
  > = runtimeNodeAdministrationService,
) {
  requireAdminUser(event);
  const nodeId = getRouterParam(event, "nodeId")?.trim() ?? "";
  return await service.probeNode(nodeId);
}

export default defineGatewayEventHandler(async (event) => await probeRuntimeNodeForEvent(event));
