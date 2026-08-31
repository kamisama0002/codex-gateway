import type { H3Event } from "h3";
import { requireAuthenticatedUser } from "../../utils/gateway/auth/context";
import { defineGatewayEventHandler } from "../../utils/gateway/http/errors";
import { runtimeService } from "../../utils/gateway/runtime-manager/runtime-service";

export function runtimeStatusForEvent(
  event: H3Event,
  service: { getStatus(userId: number): unknown } = runtimeService,
) {
  return service.getStatus(requireAuthenticatedUser(event).id);
}

export default defineGatewayEventHandler((event) => runtimeStatusForEvent(event));
