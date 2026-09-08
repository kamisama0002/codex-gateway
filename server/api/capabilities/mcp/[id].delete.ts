import { getRouterParam, type H3Event } from "h3";
import { requireAuthenticatedUser } from "~~/server/utils/gateway/auth/context";
import { capabilityAdministrationService } from "~~/server/utils/gateway/capabilities/administration";
import { capabilityIdSchema } from "~~/server/utils/gateway/capabilities/schemas";
import { defineGatewayEventHandler } from "~~/server/utils/gateway/http/errors";

export async function deletePersonalMcpForEvent(
  event: H3Event,
  service: {
    deletePersonalMcp(id: string, actorUserId: number): Promise<unknown>;
  } = capabilityAdministrationService,
) {
  const user = requireAuthenticatedUser(event);
  const id = capabilityIdSchema.parse(getRouterParam(event, "id"));
  return await service.deletePersonalMcp(id, user.id);
}

export default defineGatewayEventHandler(async (event) => await deletePersonalMcpForEvent(event));
