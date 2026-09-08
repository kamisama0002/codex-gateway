import { z } from "zod";
import { dataOpsClaimsSchema, type DataOpsClaims } from "./dataops-claims";

const exchangeEnvelopeSchema = z.looseObject({
  success: z.boolean(),
  code: z.number(),
  msg: z.string().optional(),
  data: z.unknown().optional(),
});
const bootstrapEnvelopeSchema = z.looseObject({
  success: z.boolean(),
  data: z.unknown().optional(),
});
const bootstrapStatusSchema = z.looseObject({
  status: z.string().trim().min(1).max(64),
  errorCode: z.string().trim().min(1).max(128).optional(),
});

const DEFAULT_TIMEOUT_MS = 10_000;

export class DataOpsSsoError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "DataOpsSsoError";
  }
}

interface DataOpsSsoClientOptions {
  baseUrl: string;
  sharedSecret: string;
  pairingId?: string;
  revision?: number;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}

export type DataOpsMcpBootstrapStatus = z.infer<typeof bootstrapStatusSchema>;

export interface DataOpsSsoClient {
  exchange(ticket: string): Promise<DataOpsClaims>;
  bootstrapMcpCredential(claims: DataOpsClaims): Promise<DataOpsMcpBootstrapStatus>;
}

export function createDataOpsSsoClient(options: DataOpsSsoClientOptions): DataOpsSsoClient {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  if (options.sharedSecret.trim() === "") throw new Error("DataOps SSO shared secret is required");
  const fetcher = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0)
    throw new Error("DataOps SSO timeout is invalid");

  return {
    async exchange(ticket) {
      if (ticket.trim() === "") throw new DataOpsSsoError("dataops_ticket_required");
      let response: Response;
      try {
        response = await fetcher(`${baseUrl}/api/codex-gateway/portal-tickets/exchange`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${options.sharedSecret}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ ticket }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        if (error instanceof Error && error.name === "TimeoutError") {
          throw new DataOpsSsoError("dataops_timeout");
        }
        throw new DataOpsSsoError("dataops_unavailable");
      }
      if (!response.ok) throw new DataOpsSsoError("dataops_unavailable");
      let payload: unknown;
      try {
        payload = JSON.parse(await response.text());
      } catch {
        throw new DataOpsSsoError("dataops_invalid_response");
      }
      const envelope = exchangeEnvelopeSchema.safeParse(payload);
      if (!envelope.success) throw new DataOpsSsoError("dataops_invalid_response");
      if (!envelope.data.success) throw new DataOpsSsoError("dataops_ticket_rejected");
      const claims = dataOpsClaimsSchema.safeParse(envelope.data.data);
      if (!claims.success) throw new DataOpsSsoError("dataops_invalid_response");
      return claims.data;
    },

    async bootstrapMcpCredential(claims) {
      const pairingId = options.pairingId?.trim() ?? "";
      const revision = options.revision;
      if (pairingId === "" || !Number.isSafeInteger(revision) || Number(revision) <= 0) {
        throw new DataOpsSsoError("dataops_pairing_identity_missing");
      }
      let response: Response;
      try {
        response = await fetcher(`${baseUrl}/api/codex-gateway/mcp-credential/bootstrap`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${options.sharedSecret}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            pairingId,
            revision,
            tenantId: claims.tenantId,
            dataOpsUserId: claims.userId,
            projectId: claims.projectId,
          }),
          signal: AbortSignal.timeout(Math.min(timeoutMs, 5_000)),
        });
      } catch {
        throw new DataOpsSsoError("dataops_mcp_bootstrap_unavailable");
      }
      if (!response.ok) throw new DataOpsSsoError("dataops_mcp_bootstrap_unavailable");
      try {
        const envelope = bootstrapEnvelopeSchema.parse(JSON.parse(await response.text()));
        if (!envelope.success) throw new DataOpsSsoError("dataops_mcp_bootstrap_rejected");
        return bootstrapStatusSchema.parse(envelope.data);
      } catch (error) {
        if (error instanceof DataOpsSsoError) throw error;
        throw new DataOpsSsoError("dataops_mcp_bootstrap_invalid_response");
      }
    },
  };
}

function normalizeBaseUrl(value: string) {
  const url = new URL(value);
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error("DataOps base URL is invalid");
  }
  return url.toString().replace(/\/$/, "");
}
