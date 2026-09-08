import { getRouterParam, readValidatedBody, type H3Event } from "h3";
import { requireAdminUser } from "../../../utils/gateway/auth/context";
import { capabilityAdministrationService } from "../../../utils/gateway/capabilities/administration";
import {
  capabilityIdSchema,
  parseCapabilityUpdateInput,
} from "../../../utils/gateway/capabilities/schemas";
import { defineGatewayEventHandler } from "../../../utils/gateway/http/errors";

export async function updateCapabilityForEvent(
  event: H3Event,
  service: Pick<
    typeof capabilityAdministrationService,
    "updateCapability"
  > = capabilityAdministrationService,
) {
  const admin = requireAdminUser(event);
  const id = capabilityIdSchema.parse(getRouterParam(event, "id"));
  const input = await readValidatedBody(event, parseCapabilityUpdateInput);
  return await service.updateCapability(id, input, admin.id);
}

export default defineGatewayEventHandler(async (event) => await updateCapabilityForEvent(event));
