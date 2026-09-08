import { getRouterParam, type H3Event } from "h3";
import { requireAdminUser } from "../../../utils/gateway/auth/context";
import { capabilityAdministrationService } from "../../../utils/gateway/capabilities/administration";
import { capabilityIdSchema } from "../../../utils/gateway/capabilities/schemas";
import { defineGatewayEventHandler } from "../../../utils/gateway/http/errors";

export async function deleteCapabilityForEvent(
  event: H3Event,
  service: Pick<
    typeof capabilityAdministrationService,
    "deleteCapability"
  > = capabilityAdministrationService,
) {
  const admin = requireAdminUser(event);
  const id = capabilityIdSchema.parse(getRouterParam(event, "id"));
  return await service.deleteCapability(id, admin.id);
}

export default defineGatewayEventHandler(async (event) => await deleteCapabilityForEvent(event));
