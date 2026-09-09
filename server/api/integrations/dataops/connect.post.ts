import { createError, readValidatedBody, type H3Event } from "h3";
import { tokenFromEvent } from "../../../utils/gateway/auth/context";
import { defineGatewayEventHandler } from "../../../utils/gateway/http/errors";
import {
  dataOpsConnectInputSchema,
  dataOpsPairingService,
} from "../../../utils/gateway/integrations/dataops-pairing-service";

export async function connectDataOpsForEvent(
  event: H3Event,
  service: Pick<typeof dataOpsPairingService, "connect"> = dataOpsPairingService,
) {
  const bearerSecret = tokenFromEvent(event);
  if (bearerSecret === "") throw createError({ statusCode: 401, statusMessage: "Unauthorized" });
  const body = await readValidatedBody(event, (value) => dataOpsConnectInputSchema.parse(value));
  return await service.connect(body, bearerSecret);
}

export default defineGatewayEventHandler((event) => connectDataOpsForEvent(event));
