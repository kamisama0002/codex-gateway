import { createError, defineEventHandler, readValidatedBody, type H3Event } from "h3";
import { z } from "zod";
import { DataOpsSsoError, type DataOpsSsoClient, createDataOpsSsoClient } from "../../utils/gateway/auth/dataops-client";
import { dataOpsIntegrationProvider } from "../../utils/gateway/integrations/dataops-integration-provider";
import {
  externalIdentityStore,
  type ExternalIdentityStore,
} from "../../utils/gateway/auth/external-identities";
import { dataOpsServiceToken } from "../../utils/gateway/integrations/dataops-service-token";

const inputSchema = z.object({
  ticket: z.string().trim().min(1).max(4096),
  dinkyUrl: z.string().trim().max(2048).optional(),
}).strict();

export async function loginWithDataOpsForEvent(
  event: H3Event,
  client: DataOpsSsoClient,
  identities: Pick<ExternalIdentityStore, "loginDataOps">,
) {
  const input = await readValidatedBody(event, (body) => inputSchema.parse(body));
  try {
    const claims = await client.exchange(input.ticket);
    const session = await identities.loginDataOps(claims);
    try {
      await client.bootstrapMcpCredential(claims);
    } catch {
      // Default business MCP bootstrap is best-effort and must not block the workbench login.
    }
    return session;
  } catch (error) {
    if (!(error instanceof DataOpsSsoError)) throw error;
    const statusCode = dataOpsErrorStatus(error.code);
    throw createError({ statusCode, statusMessage: error.code, message: error.code });
  }
}

export async function loginWithCurrentDataOpsForEvent(
  event: H3Event,
  provider: { current(): Promise<{ client: DataOpsSsoClient } | null> },
  identities: Pick<ExternalIdentityStore, "loginDataOps">,
) {
  const input = await readValidatedBody(event, (body) => inputSchema.parse(body));
  // If the client passed a Dinky URL, build an ad-hoc SSO client directly.
  if (input.dinkyUrl) {
    const sharedSecret = dataOpsServiceToken();
    if (!sharedSecret) {
      throw createError({ statusCode: 503, statusMessage: "dataops_not_configured" });
    }
    const client = createDataOpsSsoClient({ baseUrl: input.dinkyUrl, sharedSecret });
    return await loginWithDataOpsForEvent(event, client, identities);
  }
  // Otherwise, fall back to the configured provider.
  const integration = await provider.current();
  if (integration === null) {
    throw createError({
      statusCode: 503,
      statusMessage: "dataops_not_configured",
      message: "dataops_not_configured",
    });
  }
  return await loginWithDataOpsForEvent(event, integration.client, identities);
}

export default defineEventHandler(async (event) => {
  return await loginWithCurrentDataOpsForEvent(
    event,
    dataOpsIntegrationProvider,
    externalIdentityStore,
  );
});

function dataOpsErrorStatus(code: string): number {
  if (code === "dataops_ticket_required") return 400;
  if (code === "dataops_ticket_rejected") return 401;
  if (code === "dataops_timeout") return 504;
  return 502;
}
