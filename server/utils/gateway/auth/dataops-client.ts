import { z } from "zod";
import { dataOpsClaimsSchema, type DataOpsClaims } from "./dataops-claims";

const exchangeEnvelopeSchema = z.looseObject({
  success: z.boolean(),
  code: z.number(),
  msg: z.string().optional(),
  data: z.unknown().optional(),
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
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}

export interface DataOpsSsoClient {
  exchange(ticket: string): Promise<DataOpsClaims>;
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
  };
}

export function dataOpsSsoClientFromEnvironment(): DataOpsSsoClient {
  return createDataOpsSsoClient({
    baseUrl: process.env.DATAOPS_BASE_URL ?? "",
    sharedSecret: process.env.DATAOPS_SSO_SHARED_SECRET ?? "",
  });
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
