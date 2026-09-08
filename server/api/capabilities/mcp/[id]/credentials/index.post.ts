import { getRouterParam, readValidatedBody, type H3Event } from "h3";
import { requireAuthenticatedUser } from "~~/server/utils/gateway/auth/context";
import { capabilityAdministrationService } from "~~/server/utils/gateway/capabilities/administration";
import { capabilityIdSchema } from "~~/server/utils/gateway/capabilities/schemas";
import { credentialCreateInputSchema } from "~~/server/utils/gateway/credentials/schemas";
import { defineGatewayEventHandler } from "~~/server/utils/gateway/http/errors";

export async function createPersonalMcpCredentialForEvent(
  event: H3Event,
  service: {
    createPersonalCredential(
      input: Parameters<typeof capabilityAdministrationService.createPersonalCredential>[0],
      actorUserId: number,
    ): Promise<unknown>;
  } = capabilityAdministrationService,
) {
  const user = requireAuthenticatedUser(event);
  const capabilityId = capabilityIdSchema.parse(getRouterParam(event, "id"));
  const input = await readValidatedBody(event, (body) => credentialCreateInputSchema.parse(body));
  return await service.createPersonalCredential({ ...input, capabilityId }, user.id);
}

export default defineGatewayEventHandler(
  async (event) => await createPersonalMcpCredentialForEvent(event),
);
