import { readValidatedBody, type H3Event } from "h3";
import { defineGatewayEventHandler } from "../../../utils/gateway/http/errors";
import {
  dataOpsPairingService,
  dataOpsPairInputSchema,
} from "../../../utils/gateway/integrations/dataops-pairing-service";

export async function pairDataOpsForEvent(
  event: H3Event,
  service: Pick<typeof dataOpsPairingService, "pair"> = dataOpsPairingService,
) {
  return await service.pair(
    await readValidatedBody(event, (body) => dataOpsPairInputSchema.parse(body)),
  );
}

export default defineGatewayEventHandler((event) => pairDataOpsForEvent(event));
