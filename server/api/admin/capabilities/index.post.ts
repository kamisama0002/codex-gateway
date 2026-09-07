import { readValidatedBody, type H3Event } from "h3";
import { requireAdminUser } from "../../../utils/gateway/auth/context";
import { capabilityAdministrationService } from "../../../utils/gateway/capabilities/administration";
import { parseCapabilityCreateInput } from "../../../utils/gateway/capabilities/schemas";
import { defineGatewayEventHandler } from "../../../utils/gateway/http/errors";

export async function createCapabilityForEvent(
  event: H3Event,
  service: Pick<
    typeof capabilityAdministrationService,
    "createCapability"
  > = capabilityAdministrationService,
) {
  const admin = requireAdminUser(event);
  const input = await readValidatedBody(event, parseCapabilityCreateInput);
  return await service.createCapability(input, admin.id);
}

export default defineGatewayEventHandler(async (event) => await createCapabilityForEvent(event));
