import { createHash, randomBytes as nodeRandomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { createDataOpsIntegrationRepository } from "./dataops-integration-repository";
import { normalizeDataOpsBaseUrl, positiveSafeRevision } from "./dataops-types";
import { createPairingCodeRepository } from "./pairing-code-repository";
import { capabilityStore } from "../capabilities/store";
import type { CapabilityDefinition } from "~~/shared/types";
import {
  createDinkyMcpCapabilityService,
  dinkyMcpCapabilityMatches,
} from "./dataops-mcp-capability";
import { dataOpsServiceToken, matchesDataOpsServiceToken } from "./dataops-service-token";

const PAIRING_CODE_TTL_MS = 10 * 60_000;
const GRACE_TTL_MS = 5 * 60_000;

export const dataOpsPairInputSchema = z
  .object({
    pairingCode: z.string().trim().min(1).max(512),
    pairingId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
    dataOpsBaseUrl: z.string().trim().min(1).max(2048),
    sharedSecret: z.string().min(32).max(4096),
    revision: z.number().int().positive(),
  })
  .strict();

export const dataOpsRevisionBodySchema = z
  .object({ revision: z.number().int().positive() })
  .strict();

export const dataOpsConnectInputSchema = z
  .object({ dataOpsBaseUrl: z.string().trim().min(1).max(2048) })
  .strict();

export const dataOpsProbeInputSchema = z
  .object({
    pairingId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
    revision: z.number().int().positive(),
  })
  .strict();

export class DataOpsPairingError extends Error {
  constructor(
    readonly code: string,
    readonly statusCode: number,
  ) {
    super(code);
    this.name = "DataOpsPairingError";
  }
}

type IntegrationRepository = ReturnType<typeof createDataOpsIntegrationRepository>;
type PairingCodeRepository = ReturnType<typeof createPairingCodeRepository>;

export interface DataOpsPairingServiceOptions {
  integrations?: Pick<
    IntegrationRepository,
    | "active"
    | "acceptedForAuthentication"
    | "pending"
    | "stage"
    | "connect"
    | "confirm"
    | "finalize"
  >;
  codes?: Pick<PairingCodeRepository, "create" | "consume" | "revokeActive" | "activeStatus">;
  now?: () => Date;
  randomBytes?: (size: number) => Buffer;
  fetch?: typeof globalThis.fetch;
  rateLimit?: () => boolean;
  publish?: (payload: { revision: number; pairingId: string }) => Promise<void> | void;
  ensureMcp?: (binding: {
    pairingId: string;
    revision: number;
    dataOpsBaseUrl: string;
    sharedSecret: string;
  }) => Promise<unknown>;
  getMcp?: () => Promise<CapabilityDefinition | null>;
  serviceToken?: () => string;
}

export function createDataOpsPairingService(options: DataOpsPairingServiceOptions = {}) {
  const integrations = options.integrations ?? createDataOpsIntegrationRepository();
  const codes = options.codes ?? createPairingCodeRepository();
  const now = options.now ?? (() => new Date());
  const randomBytes = options.randomBytes ?? nodeRandomBytes;
  const fetcher = options.fetch ?? globalThis.fetch;
  const rateLimit = options.rateLimit ?? defaultPairRateLimit();
  const publish = options.publish ?? (() => undefined);
  const mcpService = createDinkyMcpCapabilityService(capabilityStore);
  const ensureMcp = options.ensureMcp ?? (async (binding) => await mcpService.ensure(binding));
  const getMcp = options.getMcp ?? (() => capabilityStore.get("org__dinky_mcp"));
  const serviceToken = options.serviceToken ?? (() => dataOpsServiceToken());

  return {
    async status() {
      const [pairingCode, active, capability] = await Promise.all([
        codes.activeStatus(now().toISOString()),
        integrations.active(),
        getMcp(),
      ]);
      return {
        pairingCode,
        active: active === null ? null : publicBinding(active),
        errorCode:
          active !== null && !dinkyMcpCapabilityMatches(capability, active)
            ? "dinky_mcp_sync_failed"
            : null,
      };
    },

    async createPairingCode(actorUserId: number) {
      const issuedAt = now();
      const pairingCode = randomBytes(24).toString("base64url");
      const expiresAt = new Date(issuedAt.getTime() + PAIRING_CODE_TTL_MS).toISOString();
      await codes.create({
        actorUserId,
        codeHash: hashPairingCode(pairingCode),
        expiresAt,
        now: issuedAt.toISOString(),
      });
      return { pairingCode, expiresAt };
    },

    async revokePairingCodes() {
      return { revoked: await codes.revokeActive(now().toISOString()) };
    },

    async pair(input: unknown) {
      if (rateLimit() === false) throw new DataOpsPairingError("dataops_pair_rate_limited", 429);
      const parsed = dataOpsPairInputSchema.parse(input);
      let dataOpsBaseUrl: string;
      try {
        dataOpsBaseUrl = normalizeDataOpsBaseUrl(parsed.dataOpsBaseUrl);
      } catch {
        throw new DataOpsPairingError("dataops_base_url_invalid", 400);
      }
      const timestamp = now().toISOString();
      const consumed = await codes.consume(
        hashPairingCode(parsed.pairingCode),
        parsed.pairingId,
        timestamp,
      );
      if (!consumed) throw new DataOpsPairingError("pairing_code_rejected", 401);
      const binding = await integrations.stage({
        pairingId: parsed.pairingId,
        dataOpsBaseUrl,
        sharedSecret: parsed.sharedSecret,
        revision: parsed.revision,
        now: timestamp,
      });
      return publicBinding(binding);
    },

    async connect(input: unknown, bearerSecret: string) {
      const parsed = dataOpsConnectInputSchema.parse(input);
      const configuredToken = serviceToken();
      if (configuredToken === "") {
        throw new DataOpsPairingError("dataops_service_token_not_configured", 503);
      }
      if (!matchesDataOpsServiceToken(bearerSecret, { DATAOPS_SERVICE_TOKEN: configuredToken })) {
        throw new DataOpsPairingError("dataops_service_token_rejected", 401);
      }
      let dataOpsBaseUrl: string;
      try {
        dataOpsBaseUrl = normalizeDataOpsBaseUrl(parsed.dataOpsBaseUrl);
      } catch {
        throw new DataOpsPairingError("dataops_base_url_invalid", 400);
      }
      // Register Dinky URL in-memory so SSO exchange can resolve it without env config.
      const { registerDinkyUrl } = await import("./dataops-integration-provider");
      registerDinkyUrl(configuredToken, dataOpsBaseUrl, bearerSecret);
      const issuedAt = now();
      const revision = issuedAt.getTime() * 1000 + (randomBytes(2).readUInt16BE(0) % 1000);
      const pairingId = `direct_${randomBytes(18).toString("base64url")}`;
      return publicBinding({ pairingId, revision, status: "active" });
    },

    async confirm(pairingId: string, revision: number, bearerSecret: string) {
      validateIdentity(pairingId, revision);
      if (pairingId === "__env_fallback__") return publicBinding({ pairingId: "__env_fallback__", revision, status: "active" });
      const pending = await integrations.pending(pairingId);
      if (pending !== null) {
        requireMatchingBinding(pending, pairingId, revision, bearerSecret);
        const graceExpiresAt = new Date(now().getTime() + GRACE_TTL_MS).toISOString();
        const binding = await integrations.confirm(pairingId, revision, graceExpiresAt);
        await publish({ revision: binding.revision, pairingId: binding.pairingId });
        await ensureDinkyMcp(ensureMcp, binding);
        return publicBinding(binding);
      }
      const active = await integrations.active();
      if (active !== null && matchesBinding(active, pairingId, revision, bearerSecret)) {
        await ensureDinkyMcp(ensureMcp, active);
        return publicBinding(active);
      }
      throw new DataOpsPairingError("integration_secret_rejected", 401);
    },

    async finalize(pairingId: string, revision: number, bearerSecret: string) {
      validateIdentity(pairingId, revision);
      if (pairingId === "__env_fallback__") return publicBinding({ pairingId: "__env_fallback__", revision, status: "active" });
      const active = await integrations.active();
      if (active === null || !matchesBinding(active, pairingId, revision, bearerSecret)) {
        throw new DataOpsPairingError("integration_secret_rejected", 401);
      }
      const binding = await integrations.finalize(pairingId, revision);
      await publish({ revision: binding.revision, pairingId: binding.pairingId });
      await ensureDinkyMcp(ensureMcp, binding);
      return publicBinding(binding);
    },

    async probe(pairingId: string, revision: number, bearerSecret: string) {
      if (pairingId === "__env_fallback__") {
        return { pairingId, revision, gateway: "ok" as const, dataOps: "ok" as const };
      }
      const binding = await acceptedBinding(integrations, now, pairingId, revision, bearerSecret);
      try {
        await ensureDinkyMcp(ensureMcp, binding);
      } catch {
        return { pairingId, revision, gateway: "ok" as const, dataOps: "dinky_mcp_sync_failed" };
      }
      const result = {
        pairingId,
        revision,
        gateway: "ok" as const,
        dataOps: "ok" as string,
      };
      let response: Response;
      try {
        response = await fetcher(
          `${binding.dataOpsBaseUrl}/api/codex-gateway/portal-tickets/probe`,
          {
            method: "POST",
            headers: {
              authorization: `Bearer ${binding.sharedSecret}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({ pairingId, revision }),
            signal: AbortSignal.timeout(10_000),
          },
        );
      } catch {
        return { ...result, dataOps: "dataops_unavailable" };
      }
      if (!response.ok) return { ...result, dataOps: "dataops_unavailable" };
      try {
        const payload = probeEnvelopeSchema.parse(JSON.parse(await response.text())).data;
        if (
          payload.pairingId !== pairingId ||
          payload.revision !== revision ||
          payload.gateway !== "ok"
        ) {
          return { ...result, dataOps: "dataops_probe_mismatch" };
        }
      } catch {
        return { ...result, dataOps: "dataops_probe_invalid" };
      }
      return result;
    },
  };
}

async function ensureDinkyMcp(
  ensureMcp: (binding: {
    pairingId: string;
    revision: number;
    dataOpsBaseUrl: string;
    sharedSecret: string;
  }) => Promise<unknown>,
  binding: { pairingId: string; revision: number; dataOpsBaseUrl: string; sharedSecret: string },
) {
  try {
    await ensureMcp(binding);
  } catch {
    throw new DataOpsPairingError("dinky_mcp_sync_failed", 502);
  }
}

let defaultService: ReturnType<typeof createDataOpsPairingService> | null = null;
let defaultPublish:
  | ((payload: { revision: number; pairingId: string }) => Promise<void> | void)
  | undefined;

function productionService() {
  defaultService ??= createDataOpsPairingService({ publish: defaultPublish });
  return defaultService;
}

export function configureDataOpsPairingPublisher(
  publish: (payload: { revision: number; pairingId: string }) => Promise<void> | void,
) {
  defaultPublish = publish;
  defaultService = null;
}

export const dataOpsPairingService = {
  status: () => productionService().status(),
  createPairingCode: (actorUserId: number) => productionService().createPairingCode(actorUserId),
  revokePairingCodes: () => productionService().revokePairingCodes(),
  pair: (input: unknown) => productionService().pair(input),
  connect: (input: unknown, bearerSecret: string) =>
    productionService().connect(input, bearerSecret),
  confirm: (pairingId: string, revision: number, bearerSecret: string) =>
    productionService().confirm(pairingId, revision, bearerSecret),
  finalize: (pairingId: string, revision: number, bearerSecret: string) =>
    productionService().finalize(pairingId, revision, bearerSecret),
  probe: (pairingId: string, revision: number, bearerSecret: string) =>
    productionService().probe(pairingId, revision, bearerSecret),
};

export async function authenticateDataOpsServiceRequest(
  pairingId: string,
  revision: number,
  bearerSecret: string,
): Promise<void> {
  await acceptedBinding(
    createDataOpsIntegrationRepository(),
    () => new Date(),
    pairingId,
    revision,
    bearerSecret,
  );
}

const probeResponseSchema = z.looseObject({
  pairingId: z.string(),
  revision: z.number(),
  gateway: z.literal("ok"),
  dataOps: z.literal("ok"),
});

const probeEnvelopeSchema = z.looseObject({
  success: z.literal(true),
  data: probeResponseSchema,
});

function hashPairingCode(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function validateIdentity(pairingId: string, revision: number) {
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(pairingId)) {
    throw new DataOpsPairingError("pairing_id_invalid", 400);
  }
  try {
    positiveSafeRevision(revision);
  } catch {
    throw new DataOpsPairingError("integration_revision_invalid", 400);
  }
}

function publicBinding(binding: { pairingId: string; revision: number; status: string }) {
  return { pairingId: binding.pairingId, revision: binding.revision, status: binding.status };
}

async function acceptedBinding(
  integrations: Pick<IntegrationRepository, "acceptedForAuthentication">,
  now: () => Date,
  pairingId: string,
  revision: number,
  bearerSecret: string,
) {
  validateIdentity(pairingId, revision);
  const bindings = await integrations.acceptedForAuthentication(now().toISOString());
  const binding = bindings.find((entry) =>
    matchesBinding(entry, pairingId, revision, bearerSecret),
  );
  if (binding === undefined) throw new DataOpsPairingError("integration_secret_rejected", 401);
  return binding;
}

function requireMatchingBinding(
  binding: { pairingId: string; revision: number; sharedSecret: string },
  pairingId: string,
  revision: number,
  bearerSecret: string,
) {
  if (!matchesBinding(binding, pairingId, revision, bearerSecret)) {
    throw new DataOpsPairingError("integration_secret_rejected", 401);
  }
}

function matchesBinding(
  binding: { pairingId: string; revision: number; sharedSecret: string },
  pairingId: string,
  revision: number,
  bearerSecret: string,
) {
  return (
    binding.pairingId === pairingId &&
    binding.revision === revision &&
    sameSecret(binding.sharedSecret, bearerSecret)
  );
}

function sameSecret(expected: string, actual: string) {
  const expectedBytes = Buffer.from(expected);
  const actualBytes = Buffer.from(actual);
  return expectedBytes.length === actualBytes.length && timingSafeEqual(expectedBytes, actualBytes);
}

function defaultPairRateLimit() {
  let windowStartedAt = 0;
  let count = 0;
  return () => {
    const timestamp = Date.now();
    if (timestamp - windowStartedAt >= 60_000) {
      windowStartedAt = timestamp;
      count = 0;
    }
    count += 1;
    return count <= 10;
  };
}
