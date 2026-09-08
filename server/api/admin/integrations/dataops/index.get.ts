import type { H3Event } from "h3";
import { requireAdminUser } from "../../../../utils/gateway/auth/context";
import { defineGatewayEventHandler } from "../../../../utils/gateway/http/errors";
import { dataOpsPairingService } from "../../../../utils/gateway/integrations/dataops-pairing-service";

export async function getDataOpsIntegrationStatusForEvent(
  event: H3Event,
  service: Pick<typeof dataOpsPairingService, "status"> = dataOpsPairingService,
) {
  requireAdminUser(event);
  return await service.status();
}

export default defineGatewayEventHandler((event) => getDataOpsIntegrationStatusForEvent(event));
