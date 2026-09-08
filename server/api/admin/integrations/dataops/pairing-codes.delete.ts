import type { H3Event } from "h3";
import { requireLocalAdminUser } from "../../../../utils/gateway/auth/context";
import { defineGatewayEventHandler } from "../../../../utils/gateway/http/errors";
import { dataOpsPairingService } from "../../../../utils/gateway/integrations/dataops-pairing-service";

export async function revokeDataOpsPairingCodesForEvent(
  event: H3Event,
  service: Pick<typeof dataOpsPairingService, "revokePairingCodes"> = dataOpsPairingService,
) {
  requireLocalAdminUser(event);
  return await service.revokePairingCodes();
}

export default defineGatewayEventHandler((event) => revokeDataOpsPairingCodesForEvent(event));
