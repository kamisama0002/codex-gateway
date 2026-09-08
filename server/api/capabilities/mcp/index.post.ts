import { readValidatedBody, type H3Event } from "h3";
import { requireAuthenticatedUser } from "~~/server/utils/gateway/auth/context";
import { capabilityAdministrationService } from "~~/server/utils/gateway/capabilities/administration";
import { parseCapabilityCreateInput } from "~~/server/utils/gateway/capabilities/schemas";
import { defineGatewayEventHandler } from "~~/server/utils/gateway/http/errors";

export async function createPersonalMcpForEvent(
  event: H3Event,
  service: {
    createPersonalMcp(
      input: Parameters<typeof capabilityAdministrationService.createPersonalMcp>[0],
      actorUserId: number,
    ): Promise<unknown>;
  } = capabilityAdministrationService,
) {
  const user = requireAuthenticatedUser(event);
  const input = await readValidatedBody(event, parseCapabilityCreateInput);
  return await service.createPersonalMcp(input, user.id);
}

export default defineGatewayEventHandler(async (event) => await createPersonalMcpForEvent(event));
