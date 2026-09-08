import type { H3Event } from "h3";
import { requireAuthenticatedUser } from "../../utils/gateway/auth/context";
import { defineGatewayEventHandler } from "../../utils/gateway/http/errors";
import { runtimeService } from "../../utils/gateway/runtime-manager/runtime-service";

export async function runtimeStatusForEvent(
  event: H3Event,
  service: { getStatusView(userId: number): Promise<unknown> } = runtimeService,
) {
  return await service.getStatusView(requireAuthenticatedUser(event).id);
}

export default defineGatewayEventHandler(async (event) => await runtimeStatusForEvent(event));
