import { createError, defineEventHandler, readValidatedBody, type H3Event } from "h3";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { DataOpsSsoError, type DataOpsSsoClient, createDataOpsSsoClient } from "../../utils/gateway/auth/dataops-client";
import { dataOpsIntegrationProvider } from "../../utils/gateway/integrations/dataops-integration-provider";
import {
  externalIdentityStore,
  type ExternalIdentityStore,
} from "../../utils/gateway/auth/external-identities";
import { dataOpsServiceToken } from "../../utils/gateway/integrations/dataops-service-token";
import type { DataOpsClaims } from "../../utils/gateway/auth/dataops-claims";

const inputSchema = z.object({
  ticket: z.string().trim().min(1).max(4096).optional(),
  identity: z.string().trim().min(1).max(4096).optional(),
  dinkyUrl: z.string().trim().max(2048).optional(),
}).strict();

/** Parse a Dinky-issued JWT-like identity token. Format: base64url(claims).base64url(signature) */
function parseDirectIdentity(raw: string, secret: string): DataOpsClaims | null {
  const parts = raw.split(".");
  if (parts.length !== 2) return null;
  try {
    const claimsJson = Buffer.from(parts[0], "base64url").toString("utf8");
    const expectedSig = createHmac("sha256", secret).update(parts[0]).digest("base64url");
    if (!timingSafeEqual(Buffer.from(parts[1]), Buffer.from(expectedSig))) return null;
    const claims = JSON.parse(claimsJson);
    if (!claims.sub || !claims.tenantId || !claims.projectId) return null;
    const platformAdmin = claims.platformAdmin === true;
    const iatEpoch = typeof claims.iat === "number" ? claims.iat : undefined;
    return {
      audience: "codex-gateway",
      contextType: "PROJECT",
      externalSubject: claims.sub,
      tenantId: claims.tenantId,
      userId: claims.userId ?? claims.sub.split(":")[2] ?? claims.tenantId,
      username: claims.username ?? String(claims.sub),
      projectId: claims.projectId,
      platformAdmin,
      canDevelopAgents: platformAdmin,
      canManageAgentStatus: platformAdmin,
      canManageAgentRuntimeConfig: platformAdmin,
      permissions: claims.permissions || [],
      authzVersion: 1,
      issuedAt: iatEpoch !== undefined ? new Date(iatEpoch * 1000).toISOString() : new Date().toISOString(),
      runtimeProfile: "default",
    };
  } catch {
    return null;
  }
}

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
  // Direct identity token: verify locally, no SSO callback needed.
  if (input.identity) {
    const sharedSecret = dataOpsServiceToken();
    if (!sharedSecret) {
      throw createError({ statusCode: 503, statusMessage: "dataops_not_configured" });
    }
    const claims = parseDirectIdentity(input.identity, sharedSecret);
    if (!claims) {
      throw createError({ statusCode: 401, statusMessage: "invalid_identity_token" });
    }
    return await identities.loginDataOps(claims);
  }
  // Legacy ticket exchange with dinkyUrl.
  if (input.dinkyUrl && input.ticket) {
    const sharedSecret = dataOpsServiceToken();
    if (!sharedSecret) {
      throw createError({ statusCode: 503, statusMessage: "dataops_not_configured" });
    }
    const client = createDataOpsSsoClient({ baseUrl: input.dinkyUrl, sharedSecret });
    return await loginWithDataOpsForEvent(event, client, identities);
  }
  // Fall back to the configured provider for traditional ticket exchange.
  if (input.ticket) {
    const integration = await provider.current();
    if (integration === null) {
      throw createError({ statusCode: 503, statusMessage: "dataops_not_configured" });
    }
    return await loginWithDataOpsForEvent(event, integration.client, identities);
  }
  throw createError({ statusCode: 400, statusMessage: "missing ticket or identity" });
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
