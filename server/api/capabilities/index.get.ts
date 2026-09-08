import { getQuery, type H3Event } from "h3";
import { requireAuthenticatedUser } from "../../utils/gateway/auth/context";
import { capabilityAdministrationService } from "../../utils/gateway/capabilities/administration";
import { defineGatewayEventHandler } from "../../utils/gateway/http/errors";
import { optionalPositiveInt } from "../../utils/gateway/http/validation/common";

export async function listUserCapabilitiesForEvent(
  event: H3Event,
  service: Pick<
    typeof capabilityAdministrationService,
    "listUserCatalog"
  > = capabilityAdministrationService,
) {
  const user = requireAuthenticatedUser(event);
  const queryProjectId = optionalPositiveInt.parse(getQuery(event).projectId) ?? null;
  return await service.listUserCatalog(user.id, user.dataOps?.projectId ?? queryProjectId);
}

export default defineGatewayEventHandler(
  async (event) => await listUserCapabilitiesForEvent(event),
);
