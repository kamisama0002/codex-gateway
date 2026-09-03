import type { H3Event } from "h3";
import { requireAdminUser } from "../../../utils/gateway/auth/context";
import { defineGatewayEventHandler } from "../../../utils/gateway/http/errors";
import { runtimeService } from "../../../utils/gateway/runtime-manager/runtime-service";

export function listRuntimesForEvent(
  event: H3Event,
  service: { listStatuses(): unknown } = runtimeService,
) {
  requireAdminUser(event);
  return service.listStatuses();
}

export default defineGatewayEventHandler((event) => listRuntimesForEvent(event));
