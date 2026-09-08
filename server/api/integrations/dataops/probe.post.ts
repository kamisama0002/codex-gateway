import { createError, readValidatedBody, type H3Event } from "h3";
import { tokenFromEvent } from "../../../utils/gateway/auth/context";
import { defineGatewayEventHandler } from "../../../utils/gateway/http/errors";
import {
  dataOpsPairingService,
  dataOpsProbeInputSchema,
} from "../../../utils/gateway/integrations/dataops-pairing-service";

export async function probeDataOpsForEvent(
  event: H3Event,
  service: Pick<typeof dataOpsPairingService, "probe"> = dataOpsPairingService,
) {
  const bearerSecret = tokenFromEvent(event);
  if (bearerSecret === "") throw createError({ statusCode: 401, statusMessage: "Unauthorized" });
  const body = await readValidatedBody(event, (value) => dataOpsProbeInputSchema.parse(value));
  return await service.probe(body.pairingId, body.revision, bearerSecret);
}

export default defineGatewayEventHandler((event) => probeDataOpsForEvent(event));
