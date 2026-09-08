import { getRouterParam, type H3Event } from "h3";
import { requireAuthenticatedUser } from "~~/server/utils/gateway/auth/context";
import { capabilityAdministrationService } from "~~/server/utils/gateway/capabilities/administration";
import { credentialIdSchema } from "~~/server/utils/gateway/credentials/schemas";
import { defineGatewayEventHandler } from "~~/server/utils/gateway/http/errors";

export async function revokePersonalMcpCredentialForEvent(
  event: H3Event,
  service: {
    revokePersonalCredential(id: string, actorUserId: number): Promise<unknown>;
  } = capabilityAdministrationService,
) {
  const user = requireAuthenticatedUser(event);
  const credentialId = credentialIdSchema.parse(getRouterParam(event, "credentialId"));
  return await service.revokePersonalCredential(credentialId, user.id);
}

export default defineGatewayEventHandler(
  async (event) => await revokePersonalMcpCredentialForEvent(event),
);
