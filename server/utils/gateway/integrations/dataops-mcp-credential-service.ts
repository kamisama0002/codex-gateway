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
    projectId: z.number().int().positive().optional(),
  })
  .strict();

export const dataOpsMcpCredentialBindSchema = identitySchema.extend({
  tokenId: z.number().int().positive().optional(),
  tokenLabel: z.string().trim().min(1).max(256).optional(),
  token: z
    .string()
    .min(1)
    .max(1024 * 1024),
}).superRefine((input, context) => {
  if ((input.tokenId === undefined) !== (input.tokenLabel === undefined)) {
    context.addIssue({
      code: "custom",
      message: "Token descriptor fields must be supplied together",
    });
  }
});
export const dataOpsMcpCredentialIdentitySchema = identitySchema;

type IdentityInput = z.infer<typeof dataOpsMcpCredentialIdentitySchema>;
type BoundToken = { tokenId: number; tokenLabel: string };
type PublicStatus = {
  status: "unbound" | "pending_sync" | "ready" | "runtime_not_ready" | "sync_failed";
  pairingId: string;
  revision: number;
  errorCode?: "runtime_not_ready" | "sync_failed";
  tokenId?: number;
  tokenLabel?: string;
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
  credentials: Pick<
    typeof credentialStore,
    "get" | "upsert" | "revoke" | "resolveSecretsForContext"
  >;
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
      const boundToken = boundTokenFromInput(input);
      const projectId = input.projectId ?? null;
      await options.credentials.upsert(
        credentialInput(userId, input.tenantId, projectId, input.token, boundToken),
      );
      await options.capabilities.assign(assignment(userId, projectId));
      return await synchronize(options, userId, projectId, input, boundToken);
    },

    async unbind(value: unknown, bearerSecret: string): Promise<PublicStatus> {
      const input = dataOpsMcpCredentialIdentitySchema.parse(value);
      const userId = await authenticatedUser(options, input, bearerSecret);
      const projectId = input.projectId ?? null;
      const credential = await options.credentials.get(credentialId(userId, projectId));
      if (credential !== null && credential.revokedAt === null) {
        await options.credentials.revoke(credential.id);
      }
      await options.capabilities.unassign(assignment(userId, projectId));
      const runtime = await options.runtime.getStatus(userId);
      if (runtime?.status === "ready") {
        try {
          await options.runtime.syncSecrets(userId, projectId, userId);
        } catch {
          return status(input, "sync_failed", "sync_failed");
        }
      }
      return status(input, "unbound");
    },

    async probe(value: unknown, bearerSecret: string): Promise<PublicStatus> {
      const input = dataOpsMcpCredentialIdentitySchema.parse(value);
      const userId = await authenticatedUser(options, input, bearerSecret);
      const projectId = input.projectId ?? null;
      const credential = await options.credentials.get(credentialId(userId, projectId));
      if (credential === null || credential.revokedAt !== null) return status(input, "unbound");
      return await synchronize(
        options,
        userId,
        projectId,
        input,
        await storedBoundToken(options, userId, projectId),
      );
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
  projectId: number | null,
  input: IdentityInput,
  boundToken?: BoundToken,
): Promise<PublicStatus> {
  const runtime = await options.runtime.getStatus(userId);
  if (runtime !== null && pendingRuntimeStatuses.has(runtime.status)) {
    return status(input, "pending_sync", undefined, boundToken);
  }
  if (runtime?.status !== "ready") {
    return status(input, "runtime_not_ready", "runtime_not_ready", boundToken);
  }
  try {
    await options.runtime.syncSecrets(userId, projectId, userId);
    return status(input, "ready", undefined, boundToken);
  } catch {
    return status(input, "sync_failed", "sync_failed", boundToken);
  }
}

function credentialInput(
  userId: number,
  tenantId: number,
  projectId: number | null,
  token: string,
  boundToken?: BoundToken,
): CredentialCreateInput {
  return {
    id: credentialId(userId, projectId),
    capabilityId: DINKY_MCP_CAPABILITY_ID,
    userId,
    projectId,
    kind: "token",
    secret: {
      token,
      tenantId: String(tenantId),
      ...(projectId === null ? {} : { projectId: String(projectId) }),
      ...(boundToken === undefined
        ? {}
        : { tokenId: String(boundToken.tokenId), tokenLabel: boundToken.tokenLabel }),
    },
    mappings: [
      { field: "token", target: { type: "env", name: "INFINITY_USER_TOKEN" } },
      { field: "tenantId", target: { type: "env", name: "INFINITY_TENANT_ID" } },
      ...(projectId === null
        ? []
        : [
            {
              field: "projectId",
              target: { type: "env" as const, name: "INFINITY_PROJECT_ID" },
            },
          ]),
    ],
    notBefore: null,
    expiresAt: null,
  };
}

function assignment(userId: number, projectId: number | null) {
  return { capabilityId: DINKY_MCP_CAPABILITY_ID, userId, projectId };
}

function credentialId(userId: number, projectId: number | null) {
  return projectId === null ? `cred__dinky_mcp_${userId}` : `cred__dinky_mcp_${userId}_${projectId}`;
}

function status(
  input: IdentityInput,
  value: PublicStatus["status"],
  errorCode?: PublicStatus["errorCode"],
  boundToken?: BoundToken,
): PublicStatus {
  return {
    status: value,
    pairingId: input.pairingId,
    revision: input.revision,
    ...(errorCode === undefined ? {} : { errorCode }),
    ...(boundToken === undefined ? {} : boundToken),
  };
}

function boundTokenFromInput(
  input: z.infer<typeof dataOpsMcpCredentialBindSchema>,
): BoundToken | undefined {
  if (input.tokenId === undefined || input.tokenLabel === undefined) return undefined;
  return { tokenId: input.tokenId, tokenLabel: input.tokenLabel };
}

async function storedBoundToken(
  options: ServiceOptions,
  userId: number,
  projectId: number | null,
): Promise<BoundToken | undefined> {
  const credentials = await options.credentials.resolveSecretsForContext(
    { userId, projectId },
    [DINKY_MCP_CAPABILITY_ID],
  );
  const credential = credentials.find((item) => item.id === credentialId(userId, projectId));
  const tokenId = Number(credential?.secret.tokenId);
  const tokenLabel = credential?.secret.tokenLabel?.trim();
  if (!Number.isSafeInteger(tokenId) || tokenId <= 0 || tokenLabel === undefined || tokenLabel === "") {
    return undefined;
  }
  return { tokenId, tokenLabel };
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
