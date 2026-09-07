import { readValidatedBody, type H3Event } from "h3";
import { requireAdminUser } from "../../../utils/gateway/auth/context";
import { capabilityAdministrationService } from "../../../utils/gateway/capabilities/administration";
import { credentialCreateInputSchema } from "../../../utils/gateway/credentials/schemas";
import { defineGatewayEventHandler } from "../../../utils/gateway/http/errors";

export async function createCredentialForEvent(
  event: H3Event,
  service: Pick<
    typeof capabilityAdministrationService,
    "createCredential"
  > = capabilityAdministrationService,
) {
  const admin = requireAdminUser(event);
  const input = await readValidatedBody(event, (body) => credentialCreateInputSchema.parse(body));
  return await service.createCredential(input, admin.id);
}

export default defineGatewayEventHandler(async (event) => await createCredentialForEvent(event));
