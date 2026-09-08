import { createError, readValidatedBody, type H3Event } from "h3";
import { tokenFromEvent } from "../../../utils/gateway/auth/context";
import { defineGatewayEventHandler } from "../../../utils/gateway/http/errors";
import {
  dataOpsMcpCredentialBindSchema,
  dataOpsMcpCredentialService,
} from "../../../utils/gateway/integrations/dataops-mcp-credential-service";

export async function putDataOpsMcpCredentialForEvent(
  event: H3Event,
  service: Pick<typeof dataOpsMcpCredentialService, "bind"> = dataOpsMcpCredentialService,
) {
  const secret = tokenFromEvent(event);
  if (secret === "") throw createError({ statusCode: 401, statusMessage: "Unauthorized" });
  const body = await readValidatedBody(event, (value) =>
    dataOpsMcpCredentialBindSchema.parse(value),
  );
  return await service.bind(body, secret);
}

export default defineGatewayEventHandler((event) => putDataOpsMcpCredentialForEvent(event));
