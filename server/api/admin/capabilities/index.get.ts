import type { H3Event } from "h3";
import { requireAdminUser } from "../../../utils/gateway/auth/context";
import { capabilityAdministrationService } from "../../../utils/gateway/capabilities/administration";
import { defineGatewayEventHandler } from "../../../utils/gateway/http/errors";

export async function listAdminCapabilitiesForEvent(
  event: H3Event,
  service: Pick<
    typeof capabilityAdministrationService,
    "listAdminCatalog"
  > = capabilityAdministrationService,
) {
  requireAdminUser(event);
  return await service.listAdminCatalog();
}

export default defineGatewayEventHandler(
  async (event) => await listAdminCapabilitiesForEvent(event),
);
