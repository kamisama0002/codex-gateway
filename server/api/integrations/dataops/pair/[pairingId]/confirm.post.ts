import { createError, getRouterParam, readValidatedBody, type H3Event } from "h3";
import { tokenFromEvent } from "../../../../../utils/gateway/auth/context";
import { defineGatewayEventHandler } from "../../../../../utils/gateway/http/errors";
import {
  dataOpsPairingService,
  dataOpsRevisionBodySchema,
} from "../../../../../utils/gateway/integrations/dataops-pairing-service";

export async function confirmDataOpsPairingForEvent(
  event: H3Event,
  pairingId = getRouterParam(event, "pairingId") ?? "",
  service: Pick<typeof dataOpsPairingService, "confirm"> = dataOpsPairingService,
) {
  const bearerSecret = tokenFromEvent(event);
  if (bearerSecret === "") throw createError({ statusCode: 401, statusMessage: "Unauthorized" });
  const body = await readValidatedBody(event, (value) => dataOpsRevisionBodySchema.parse(value));
  return await service.confirm(pairingId, body.revision, bearerSecret);
}

export default defineGatewayEventHandler((event) => confirmDataOpsPairingForEvent(event));
