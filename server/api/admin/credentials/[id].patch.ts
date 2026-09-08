import { getRouterParam, readValidatedBody, type H3Event } from "h3";
import { z } from "zod";
import { requireAdminUser } from "../../../utils/gateway/auth/context";
import { capabilityAdministrationService } from "../../../utils/gateway/capabilities/administration";
import { credentialIdSchema } from "../../../utils/gateway/credentials/schemas";
import { defineGatewayEventHandler } from "../../../utils/gateway/http/errors";

const rotateCredentialSchema = z
  .object({
    secret: z.record(
      z.string(),
      z
        .string()
        .min(1)
        .max(1024 * 1024),
    ),
  })
  .strict();

export async function rotateCredentialForEvent(
  event: H3Event,
  service: Pick<
    typeof capabilityAdministrationService,
    "rotateCredential"
  > = capabilityAdministrationService,
) {
  const admin = requireAdminUser(event);
  const id = credentialIdSchema.parse(getRouterParam(event, "id"));
  const input = await readValidatedBody(event, (body) => rotateCredentialSchema.parse(body));
  return await service.rotateCredential(id, input.secret, admin.id);
}

export default defineGatewayEventHandler(async (event) => await rotateCredentialForEvent(event));
