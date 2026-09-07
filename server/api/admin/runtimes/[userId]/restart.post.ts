import { createError, getRouterParam, type H3Event } from "h3";
import { requireAdminUser } from "../../../../utils/gateway/auth/context";
import { defineGatewayEventHandler } from "../../../../utils/gateway/http/errors";
import { runtimeService } from "../../../../utils/gateway/runtime-manager/runtime-service";

export async function restartRuntimeForEvent(
  event: H3Event,
  service: { restart(userId: number, actorUserId: number): Promise<unknown> } = runtimeService,
) {
  const admin = requireAdminUser(event);
  const targetUserId = Number(getRouterParam(event, "userId"));
  if (!Number.isInteger(targetUserId) || targetUserId <= 0) {
    throw createError({ statusCode: 400, statusMessage: "Invalid user ID" });
  }
  return await service.restart(targetUserId, admin.id);
}

export default defineGatewayEventHandler(async (event) => await restartRuntimeForEvent(event));
