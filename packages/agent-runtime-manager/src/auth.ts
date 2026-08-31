import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";

const MAX_CLOCK_SKEW_MS = 5 * 60 * 1_000;
const SHA_256_HEX = /^[a-f0-9]{64}$/;
const NONCE = /^[A-Za-z0-9_-]{1,128}$/;

export const DEFAULT_RUNTIME_MANAGER_NONCE_STORE_PATH = "/data/runtime-manager-nonces.sqlite";

export type RuntimeAuthHeaders = Record<string, string | string[] | undefined>;

export interface HmacRequestAuthenticatorOptions {
  secret: string;
  nonceStore: NonceStore;
  now?: () => number;
}

export interface NonceStore {
  claim(nonce: string, expiresAt: number, currentTime: number): boolean;
}

export class SqliteNonceStore implements NonceStore {
  private readonly database: DatabaseSync;
  private readonly insertStatement: StatementSync;
  private readonly pruneStatement: StatementSync;

  constructor(path: string = DEFAULT_RUNTIME_MANAGER_NONCE_STORE_PATH) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.database = new DatabaseSync(path);
    this.database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS runtime_manager_nonces (
        nonce TEXT PRIMARY KEY NOT NULL,
        expires_at_ms INTEGER NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS runtime_manager_nonces_expiry
        ON runtime_manager_nonces (expires_at_ms);
    `);
    this.pruneStatement = this.database.prepare(
      "DELETE FROM runtime_manager_nonces WHERE expires_at_ms < ?",
    );
    this.insertStatement = this.database.prepare(
      "INSERT OR IGNORE INTO runtime_manager_nonces (nonce, expires_at_ms) VALUES (?, ?)",
    );
  }

  claim(nonce: string, expiresAt: number, currentTime: number): boolean {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.pruneStatement.run(currentTime);
      const result = this.insertStatement.run(nonce, expiresAt);
      this.database.exec("COMMIT");
      return result.changes === 1 || result.changes === 1n;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  close(): void {
    this.database.close();
  }
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
  private readonly nonceStore: NonceStore;
  private readonly now: () => number;
  private readonly secret: string;

  constructor(options: HmacRequestAuthenticatorOptions) {
    if (!options.secret) throw new Error("RUNTIME_MANAGER_SHARED_SECRET is required");
    this.secret = options.secret;
    this.nonceStore = options.nonceStore;
    this.now = options.now ?? Date.now;
  }

  authenticate(
    headers: RuntimeAuthHeaders,
    body: Uint8Array,
  ): { timestamp: number; nonce: string } {
    try {
      const currentTime = this.now();

      const timestampHeader = readHeader(headers, "x-runtime-timestamp");
      const nonce = readHeader(headers, "x-runtime-nonce");
      const bodySha256 = readHeader(headers, "x-runtime-body-sha256");
      const signature = readHeader(headers, "x-runtime-signature");
      const timestamp = Number(timestampHeader);

      if (
        !Number.isSafeInteger(timestamp) ||
        timestamp > Number.MAX_SAFE_INTEGER - MAX_CLOCK_SKEW_MS ||
        Math.abs(currentTime - timestamp) > MAX_CLOCK_SKEW_MS ||
        !NONCE.test(nonce) ||
        !SHA_256_HEX.test(bodySha256) ||
        !SHA_256_HEX.test(signature)
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

      const claimed = this.nonceStore.claim(nonce, timestamp + MAX_CLOCK_SKEW_MS, currentTime);
      if (!claimed) throw new RuntimeAuthenticationError();
      return { timestamp, nonce };
    } catch (error) {
      if (error instanceof RuntimeAuthenticationError) throw error;
      throw new RuntimeAuthenticationError();
    }
  }
}

export function resolveRuntimeManagerNonceStorePath(environment: NodeJS.ProcessEnv): string {
  const configuredPath = environment.RUNTIME_MANAGER_NONCE_STORE_PATH;
  return configuredPath === undefined || configuredPath.length === 0
    ? DEFAULT_RUNTIME_MANAGER_NONCE_STORE_PATH
    : configuredPath;
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
