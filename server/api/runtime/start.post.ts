import type { H3Event } from "h3";
import { requireAuthenticatedUser } from "../../utils/gateway/auth/context";
import { defineGatewayEventHandler } from "../../utils/gateway/http/errors";
import { runtimeService } from "../../utils/gateway/runtime-manager/runtime-service";

export function startRuntimeForEvent(
  event: H3Event,
  service: { start(userId: number, actorUserId: number): Promise<unknown> } = runtimeService,
) {
  const user = requireAuthenticatedUser(event);
  return service.start(user.id, user.id);
}

export default defineGatewayEventHandler((event) => startRuntimeForEvent(event));
