import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const MAX_CLOCK_SKEW_MS = 5 * 60 * 1_000;
const SHA_256_HEX = /^[a-f0-9]{64}$/;
const NONCE = /^[A-Za-z0-9_-]{1,128}$/;

export type RuntimeAuthHeaders = Record<string, string | string[] | undefined>;

export interface HmacRequestAuthenticatorOptions {
  secret: string;
  now?: () => number;
}

export class RuntimeAuthenticationError extends Error {
  readonly code = "unauthorized";

  constructor() {
    super("unauthorized");
    this.name = "RuntimeAuthenticationError";
  }
}

export function createBodySha256(body: Uint8Array): string {
  return createHash("sha256").update(body).digest("hex");
}

export function createRequestSignature(
  secret: string,
  timestamp: number,
  nonce: string,
  bodySha256: string,
): string {
  return createHmac("sha256", secret)
    .update(`${timestamp}\n${nonce}\n${bodySha256}`, "utf8")
    .digest("hex");
}

export function createSignedHeaders(options: {
  secret: string;
  timestamp: number;
  nonce: string;
  body: Uint8Array;
}): Record<string, string> {
  const bodySha256 = createBodySha256(options.body);
  return {
    "x-runtime-body-sha256": bodySha256,
    "x-runtime-nonce": options.nonce,
    "x-runtime-signature": createRequestSignature(
      options.secret,
      options.timestamp,
      options.nonce,
      bodySha256,
    ),
    "x-runtime-timestamp": String(options.timestamp),
  };
}

export class HmacRequestAuthenticator {
  private readonly nonces = new Map<string, number>();
  private readonly now: () => number;
  private readonly secret: string;

  constructor(options: HmacRequestAuthenticatorOptions) {
    if (!options.secret) throw new Error("RUNTIME_MANAGER_SHARED_SECRET is required");
    this.secret = options.secret;
    this.now = options.now ?? Date.now;
  }

  authenticate(
    headers: RuntimeAuthHeaders,
    body: Uint8Array,
  ): { timestamp: number; nonce: string } {
    try {
      const currentTime = this.now();
      this.pruneExpiredNonces(currentTime);

      const timestampHeader = readHeader(headers, "x-runtime-timestamp");
      const nonce = readHeader(headers, "x-runtime-nonce");
      const bodySha256 = readHeader(headers, "x-runtime-body-sha256");
      const signature = readHeader(headers, "x-runtime-signature");
      const timestamp = Number(timestampHeader);

      if (
        !Number.isSafeInteger(timestamp) ||
        Math.abs(currentTime - timestamp) > MAX_CLOCK_SKEW_MS ||
        !NONCE.test(nonce) ||
        !SHA_256_HEX.test(bodySha256) ||
        !SHA_256_HEX.test(signature) ||
        this.nonces.has(nonce)
      ) {
        throw new RuntimeAuthenticationError();
      }

      const actualBodySha256 = createBodySha256(body);
      const expectedSignature = createRequestSignature(this.secret, timestamp, nonce, bodySha256);
      if (
        !safeEqualHex(bodySha256, actualBodySha256) ||
        !safeEqualHex(signature, expectedSignature)
      ) {
        throw new RuntimeAuthenticationError();
      }

      this.nonces.set(nonce, currentTime + MAX_CLOCK_SKEW_MS);
      return { timestamp, nonce };
    } catch (error) {
      if (error instanceof RuntimeAuthenticationError) throw error;
      throw new RuntimeAuthenticationError();
    }
  }

  private pruneExpiredNonces(currentTime: number): void {
    for (const [nonce, expiresAt] of this.nonces) {
      if (expiresAt < currentTime) this.nonces.delete(nonce);
    }
  }
}

function readHeader(headers: RuntimeAuthHeaders, name: string): string {
  const value = headers[name];
  if (typeof value !== "string") throw new RuntimeAuthenticationError();
  return value;
}

function safeEqualHex(left: string, right: string): boolean {
  if (!SHA_256_HEX.test(left) || !SHA_256_HEX.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}
