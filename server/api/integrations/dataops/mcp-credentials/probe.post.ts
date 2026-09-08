import { createError, readValidatedBody, type H3Event } from "h3";
import { tokenFromEvent } from "../../../../utils/gateway/auth/context";
import { defineGatewayEventHandler } from "../../../../utils/gateway/http/errors";
import {
  dataOpsMcpCredentialIdentitySchema,
  dataOpsMcpCredentialService,
} from "../../../../utils/gateway/integrations/dataops-mcp-credential-service";

export async function probeDataOpsMcpCredentialForEvent(
  event: H3Event,
  service: Pick<typeof dataOpsMcpCredentialService, "probe"> = dataOpsMcpCredentialService,
) {
  const secret = tokenFromEvent(event);
  if (secret === "") throw createError({ statusCode: 401, statusMessage: "Unauthorized" });
  const body = await readValidatedBody(event, (value) =>
    dataOpsMcpCredentialIdentitySchema.parse(value),
  );
  return await service.probe(body, secret);
}

export default defineGatewayEventHandler((event) => probeDataOpsMcpCredentialForEvent(event));
