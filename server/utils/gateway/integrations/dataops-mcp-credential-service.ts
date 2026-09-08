import { z } from "zod";
import type { CredentialCreateInput } from "~~/shared/types";
import { capabilityStore } from "../capabilities/store";
import { credentialStore } from "../credentials/store";
import { runtimeService } from "../runtime-manager/runtime-service";
import { gatewayDatabase } from "../storage/database";
import { DINKY_MCP_CAPABILITY_ID } from "./dataops-mcp-capability";
import { authenticateDataOpsServiceRequest } from "./dataops-pairing-service";

const identitySchema = z
  .object({
    pairingId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/u),
    revision: z.number().int().positive(),
    tenantId: z.number().int().positive(),
    dataOpsUserId: z.number().int().positive(),
  })
  .strict();

export const dataOpsMcpCredentialBindSchema = identitySchema.extend({
  token: z
    .string()
    .min(1)
    .max(1024 * 1024),
});
export const dataOpsMcpCredentialIdentitySchema = identitySchema;

type IdentityInput = z.infer<typeof dataOpsMcpCredentialIdentitySchema>;
type PublicStatus = {
  status: "unbound" | "pending_sync" | "ready" | "runtime_not_ready" | "sync_failed";
  pairingId: string;
  revision: number;
  errorCode?: "runtime_not_ready" | "sync_failed";
};

const pendingRuntimeStatuses = new Set([
  "provisioning",
  "starting",
  "schema_checking",
  "syncing_capabilities",
  "restarting",
]);

interface ServiceOptions {
  authenticate(pairingId: string, revision: number, bearerSecret: string): Promise<void>;
  resolveUser(tenantId: number, dataOpsUserId: number): Promise<number | null>;
  credentials: Pick<typeof credentialStore, "get" | "upsert" | "revoke">;
  capabilities: Pick<typeof capabilityStore, "assign" | "unassign">;
  runtime: Pick<typeof runtimeService, "getStatus" | "syncSecrets">;
}

export class DataOpsMcpCredentialError extends Error {
  constructor(
    readonly code: string,
    readonly statusCode: number,
  ) {
    super(code);
    this.name = "DataOpsMcpCredentialError";
  }
}

export function createDataOpsMcpCredentialService(options: ServiceOptions) {
  return {
    async bind(value: unknown, bearerSecret: string): Promise<PublicStatus> {
      const input = dataOpsMcpCredentialBindSchema.parse(value);
      const userId = await authenticatedUser(options, input, bearerSecret);
      await options.capabilities.assign(assignment(userId));
      await options.credentials.upsert(credentialInput(userId, input.tenantId, input.token));
      return await synchronize(options, userId, input);
    },

    async unbind(value: unknown, bearerSecret: string): Promise<PublicStatus> {
      const input = dataOpsMcpCredentialIdentitySchema.parse(value);
      const userId = await authenticatedUser(options, input, bearerSecret);
      const credential = await options.credentials.get(credentialId(userId));
      if (credential !== null && credential.revokedAt === null) {
        await options.credentials.revoke(credential.id);
      }
      await options.capabilities.unassign(assignment(userId));
      const runtime = await options.runtime.getStatus(userId);
      if (runtime?.status === "ready") {
        try {
          await options.runtime.syncSecrets(userId, null, userId);
        } catch {
          return status(input, "sync_failed", "sync_failed");
        }
      }
      return status(input, "unbound");
    },

    async probe(value: unknown, bearerSecret: string): Promise<PublicStatus> {
      const input = dataOpsMcpCredentialIdentitySchema.parse(value);
      const userId = await authenticatedUser(options, input, bearerSecret);
      const credential = await options.credentials.get(credentialId(userId));
      if (credential === null || credential.revokedAt !== null) return status(input, "unbound");
      return await synchronize(options, userId, input);
    },
  };
}

export const dataOpsMcpCredentialService = createDataOpsMcpCredentialService({
  authenticate: authenticateDataOpsServiceRequest,
  resolveUser: resolveDataOpsUser,
  credentials: credentialStore,
  capabilities: capabilityStore,
  runtime: runtimeService,
});

async function authenticatedUser(
  options: ServiceOptions,
  input: IdentityInput,
  bearerSecret: string,
) {
  if (bearerSecret === "") throw new DataOpsMcpCredentialError("integration_secret_rejected", 401);
  await options.authenticate(input.pairingId, input.revision, bearerSecret);
  const userId = await options.resolveUser(input.tenantId, input.dataOpsUserId);
  if (userId === null) throw new DataOpsMcpCredentialError("dataops_user_not_found", 404);
  return userId;
}

async function synchronize(
  options: ServiceOptions,
  userId: number,
  input: IdentityInput,
): Promise<PublicStatus> {
  const runtime = await options.runtime.getStatus(userId);
  if (runtime !== null && pendingRuntimeStatuses.has(runtime.status)) {
    return status(input, "pending_sync");
  }
  if (runtime?.status !== "ready") {
    return status(input, "runtime_not_ready", "runtime_not_ready");
  }
  try {
    await options.runtime.syncSecrets(userId, null, userId);
    return status(input, "ready");
  } catch {
    return status(input, "sync_failed", "sync_failed");
  }
}

function credentialInput(userId: number, tenantId: number, token: string): CredentialCreateInput {
  return {
    id: credentialId(userId),
    capabilityId: DINKY_MCP_CAPABILITY_ID,
    userId,
    projectId: null,
    kind: "token",
    secret: { token, tenantId: String(tenantId) },
    mappings: [
      { field: "token", target: { type: "env", name: "INFINITY_USER_TOKEN" } },
      { field: "tenantId", target: { type: "env", name: "INFINITY_TENANT_ID" } },
    ],
    notBefore: null,
    expiresAt: null,
  };
}

function assignment(userId: number) {
  return { capabilityId: DINKY_MCP_CAPABILITY_ID, userId, projectId: null };
}

function credentialId(userId: number) {
  return `cred__dinky_mcp_${userId}`;
}

function status(
  input: IdentityInput,
  value: PublicStatus["status"],
  errorCode?: PublicStatus["errorCode"],
): PublicStatus {
  return {
    status: value,
    pairingId: input.pairingId,
    revision: input.revision,
    ...(errorCode === undefined ? {} : { errorCode }),
  };
}

async function resolveDataOpsUser(tenantId: number, dataOpsUserId: number): Promise<number | null> {
  const row = await gatewayDatabase().one<{ user_id: number | string | bigint }>(
    `SELECT identities.user_id
     FROM external_identities identities
     JOIN users ON users.id = identities.user_id
     WHERE identities.provider = 'dataops'
       AND identities.external_subject = ?
       AND users.is_active = 1`,
    [`dataops:${tenantId}:${dataOpsUserId}`],
  );
  if (row === null) return null;
  const userId = Number(row.user_id);
  return Number.isSafeInteger(userId) && userId > 0 ? userId : null;
}
