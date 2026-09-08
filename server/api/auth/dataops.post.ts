import { createError, defineEventHandler, readValidatedBody, type H3Event } from "h3";
import { z } from "zod";
import { DataOpsSsoError, type DataOpsSsoClient } from "../../utils/gateway/auth/dataops-client";
import { dataOpsIntegrationProvider } from "../../utils/gateway/integrations/dataops-integration-provider";
import {
  externalIdentityStore,
  type ExternalIdentityStore,
} from "../../utils/gateway/auth/external-identities";

const inputSchema = z.object({ ticket: z.string().trim().min(1).max(4096) }).strict();

export async function loginWithDataOpsForEvent(
  event: H3Event,
  client: DataOpsSsoClient,
  identities: Pick<ExternalIdentityStore, "loginDataOps">,
) {
  const input = await readValidatedBody(event, (body) => inputSchema.parse(body));
  try {
    const claims = await client.exchange(input.ticket);
    return await identities.loginDataOps(claims);
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
  const integration = await provider.current();
  if (integration === null) {
    throw createError({ statusCode: 503, statusMessage: "dataops_not_configured", message: "dataops_not_configured" });
  }
  return await loginWithDataOpsForEvent(event, integration.client, identities);
}

export default defineEventHandler(async (event) => {
  return await loginWithCurrentDataOpsForEvent(event, dataOpsIntegrationProvider, externalIdentityStore);
});

function dataOpsErrorStatus(code: string): number {
  if (code === "dataops_ticket_required") return 400;
  if (code === "dataops_ticket_rejected") return 401;
  if (code === "dataops_timeout") return 504;
  return 502;
}
