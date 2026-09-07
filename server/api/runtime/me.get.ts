import type { H3Event } from "h3";
import { requireAuthenticatedUser } from "../../utils/gateway/auth/context";
import { defineGatewayEventHandler } from "../../utils/gateway/http/errors";
import { runtimeService } from "../../utils/gateway/runtime-manager/runtime-service";

export async function runtimeStatusForEvent(
  event: H3Event,
  service: { getStatus(userId: number): Promise<unknown> } = runtimeService,
) {
  return await service.getStatus(requireAuthenticatedUser(event).id);
}

export default defineGatewayEventHandler(async (event) => await runtimeStatusForEvent(event));
