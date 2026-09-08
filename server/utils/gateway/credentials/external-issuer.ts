import { z } from "zod";

const MAX_ISSUER_RESPONSE_BYTES = 64 * 1024;
const MIN_REMAINING_LIFETIME_MS = 60_000;

export interface ExternalIssuerDefinition {
  url: string;
  audience: string;
  timeoutMs: number;
}

export interface ExternalIssuerContext {
  userId: number;
  projectId: number | null;
  capabilityId: string;
}

interface ExternalCredentialIssuerOptions {
  allowedOrigins: string[];
  fetch?: typeof globalThis.fetch;
  now?: () => number;
}

const responseSchema = z
  .object({
    token: z.string().min(1).max(4096),
    expiresAt: z.string().refine((value) => Number.isFinite(Date.parse(value))),
  })
  .strict();

export class ExternalCredentialIssuer {
  private readonly allowedOrigins: Set<string>;
  private readonly fetch: typeof globalThis.fetch;
  private readonly now: () => number;

  constructor(options: ExternalCredentialIssuerOptions) {
    this.allowedOrigins = new Set(options.allowedOrigins.map(normalizedAllowedOrigin));
    this.fetch = options.fetch ?? globalThis.fetch;
    this.now = options.now ?? Date.now;
  }

  async issue(definition: ExternalIssuerDefinition, context: ExternalIssuerContext) {
    const url = allowedIssuerUrl(definition.url, this.allowedOrigins);
    if (
      !Number.isInteger(definition.timeoutMs) ||
      definition.timeoutMs < 100 ||
      definition.timeoutMs > 30_000
    ) {
      throw new Error("External credential issuer timeout is invalid");
    }
    if (definition.audience.trim() === "" || definition.audience.length > 256) {
      throw new Error("External credential issuer audience is invalid");
    }
    const response = await this.fetch(url.toString(), {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        audience: definition.audience,
        capabilityId: context.capabilityId,
        projectId: context.projectId,
        userId: context.userId,
      }),
      signal: AbortSignal.timeout(definition.timeoutMs),
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error("External credential issuer rejected the request");
    }
    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > MAX_ISSUER_RESPONSE_BYTES) {
      throw new Error("External credential issuer response is too large");
    }
    const payload = responseSchema.parse(JSON.parse(await readBoundedBody(response)) as unknown);
    if (Date.parse(payload.expiresAt) - this.now() < MIN_REMAINING_LIFETIME_MS) {
      throw new Error("External credential issuer token expires too soon");
    }
    return payload;
  }
}

export function externalCredentialIssuerFromEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
) {
  const allowedOrigins = (environment.EXTERNAL_CREDENTIAL_ISSUER_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value !== "");
  return new ExternalCredentialIssuer({ allowedOrigins });
}

async function readBoundedBody(response: Response) {
  if (response.body === null) throw new Error("External credential issuer returned no body");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_ISSUER_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error("External credential issuer response is too large");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function normalizedAllowedOrigin(value: string) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.origin !== value.replace(/\/$/u, "") ||
    url.username !== "" ||
    url.password !== ""
  ) {
    throw new Error("External credential issuer origin is invalid");
  }
  return url.origin;
}

function allowedIssuerUrl(value: string, allowedOrigins: Set<string>) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== "" ||
    !allowedOrigins.has(url.origin)
  ) {
    throw new Error("External credential issuer URL is not allowed");
  }
  return url;
}
