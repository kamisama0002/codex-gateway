import { getRouterParam, type H3Event } from "h3";
import { requireAdminUser } from "../../../utils/gateway/auth/context";
import { capabilityAdministrationService } from "../../../utils/gateway/capabilities/administration";
import { credentialIdSchema } from "../../../utils/gateway/credentials/schemas";
import { defineGatewayEventHandler } from "../../../utils/gateway/http/errors";

export async function revokeCredentialForEvent(
  event: H3Event,
  service: Pick<
    typeof capabilityAdministrationService,
    "revokeCredential"
  > = capabilityAdministrationService,
) {
  const admin = requireAdminUser(event);
  const id = credentialIdSchema.parse(getRouterParam(event, "id"));
  return await service.revokeCredential(id, admin.id);
}

export default defineGatewayEventHandler(async (event) => await revokeCredentialForEvent(event));
