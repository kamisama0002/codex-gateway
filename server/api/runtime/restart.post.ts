import type { H3Event } from "h3";
import { requireAuthenticatedUser } from "../../utils/gateway/auth/context";
import { defineGatewayEventHandler } from "../../utils/gateway/http/errors";
import { runtimeService } from "../../utils/gateway/runtime-manager/runtime-service";

export async function restartOwnRuntimeForEvent(
  event: H3Event,
  service: {
    restart(userId: number, actorUserId: number): Promise<unknown>;
    getStatusView(userId: number): Promise<unknown>;
  } = runtimeService,
) {
  const user = requireAuthenticatedUser(event);
  await service.restart(user.id, user.id);
  return await service.getStatusView(user.id);
}

export default defineGatewayEventHandler(async (event) => await restartOwnRuntimeForEvent(event));
