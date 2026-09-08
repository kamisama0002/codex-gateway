import type { H3Event } from "h3";
import { requireLocalAdminUser } from "../../../../utils/gateway/auth/context";
import { defineGatewayEventHandler } from "../../../../utils/gateway/http/errors";
import { dataOpsPairingService } from "../../../../utils/gateway/integrations/dataops-pairing-service";

export async function createDataOpsPairingCodeForEvent(
  event: H3Event,
  service: Pick<typeof dataOpsPairingService, "createPairingCode"> = dataOpsPairingService,
) {
  return await service.createPairingCode(requireLocalAdminUser(event).id);
}

export default defineGatewayEventHandler((event) => createDataOpsPairingCodeForEvent(event));
