import { createError, defineEventHandler, readValidatedBody, type H3Event } from "h3";
import { z } from "zod";
import {
  dataOpsSsoClientFromEnvironment,
  DataOpsSsoError,
  type DataOpsSsoClient,
} from "../../utils/gateway/auth/dataops-client";
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
    return identities.loginDataOps(claims);
  } catch (error) {
    if (!(error instanceof DataOpsSsoError)) throw error;
    const statusCode = dataOpsErrorStatus(error.code);
    throw createError({ statusCode, statusMessage: error.code, message: error.code });
  }
}

export default defineEventHandler(async (event) => {
  let client: DataOpsSsoClient;
  try {
    client = dataOpsSsoClientFromEnvironment();
  } catch {
    throw createError({
      statusCode: 503,
      statusMessage: "dataops_not_configured",
      message: "dataops_not_configured",
    });
  }
  return await loginWithDataOpsForEvent(event, client, externalIdentityStore);
});

function dataOpsErrorStatus(code: string): number {
  if (code === "dataops_ticket_required") return 400;
  if (code === "dataops_ticket_rejected") return 401;
  if (code === "dataops_timeout") return 504;
  return 502;
}
