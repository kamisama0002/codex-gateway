import { getRouterParam, readValidatedBody, type H3Event } from "h3";
import { requireAuthenticatedUser } from "~~/server/utils/gateway/auth/context";
import { capabilityAdministrationService } from "~~/server/utils/gateway/capabilities/administration";
import {
  capabilityIdSchema,
  parseCapabilityUpdateInput,
} from "~~/server/utils/gateway/capabilities/schemas";
import { defineGatewayEventHandler } from "~~/server/utils/gateway/http/errors";

export async function updatePersonalMcpForEvent(
  event: H3Event,
  service: {
    updatePersonalMcp(
      id: string,
      input: Parameters<typeof capabilityAdministrationService.updatePersonalMcp>[1],
      actorUserId: number,
    ): Promise<unknown>;
  } = capabilityAdministrationService,
) {
  const user = requireAuthenticatedUser(event);
  const id = capabilityIdSchema.parse(getRouterParam(event, "id"));
  const input = await readValidatedBody(event, parseCapabilityUpdateInput);
  return await service.updatePersonalMcp(id, input, user.id);
}

export default defineGatewayEventHandler(async (event) => await updatePersonalMcpForEvent(event));
