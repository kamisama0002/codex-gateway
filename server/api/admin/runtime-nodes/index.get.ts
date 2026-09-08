import type { H3Event } from "h3";
import { requireAdminUser } from "../../../utils/gateway/auth/context";
import { defineGatewayEventHandler } from "../../../utils/gateway/http/errors";
import { runtimeNodeAdministrationService } from "../../../utils/gateway/runtime-manager/runtime-node-administration";

export function listRuntimeNodesForEvent(
  event: H3Event,
  service: Pick<
    typeof runtimeNodeAdministrationService,
    "listNodes"
  > = runtimeNodeAdministrationService,
) {
  requireAdminUser(event);
  return service.listNodes();
}

export default defineGatewayEventHandler(async (event) => await listRuntimeNodesForEvent(event));
