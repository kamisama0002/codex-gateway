import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

const TOKEN_VERSION = "rt1";
// Managed runtimes are intentionally long-lived. The Gateway still checks the
// current user grant on every request, so this is a bounded capability token,
// not a permanent authorization; runtime re-provisioning rotates it.
const TOKEN_TTL_MS = 30 * 24 * 60 * 60_000;

export interface RuntimeModelTokenClaims {
  userId: number;
  runtimeId: string;
  providerId: string;
  // Kept as the container's startup default; request authorization uses the provider scope and
  // the current per-user model grant so a long-lived runtime can switch models safely.
  modelId: string;
  jti: string;
  exp: number;
}

export interface RuntimeModelTokenScope {
  userId?: number;
  runtimeId?: string;
  providerId: string;
}

export function issueRuntimeModelToken(
  input: Omit<RuntimeModelTokenClaims, "jti" | "exp"> & { ttlMs?: number },
  secret = runtimeTokenSecret(),
  now = Date.now(),
): string {
  if (secret.length === 0) throw new Error("Runtime token secret is required");
  const claims: RuntimeModelTokenClaims = {
    userId: positiveId(input.userId),
    runtimeId: required(input.runtimeId),
    providerId: required(input.providerId),
    modelId: required(input.modelId),
    jti: randomUUID(),
    exp: now + (input.ttlMs ?? TOKEN_TTL_MS),
  };
  const payload = encode(claims);
  return `${TOKEN_VERSION}.${payload}.${sign(secret, payload)}`;
}

export function verifyRuntimeModelToken(
  token: string,
  scope: RuntimeModelTokenScope,
  secret = runtimeTokenSecret(),
  now = Date.now(),
): RuntimeModelTokenClaims {
  const [version, payload, signature] = token.split(".");
  if (version !== TOKEN_VERSION || payload === undefined || signature === undefined)
    throw new Error("Invalid runtime token");
  const expected = sign(secret, payload);
  if (!safeEqual(signature, expected)) throw new Error("Invalid runtime token");
  let claims: RuntimeModelTokenClaims;
  try {
    const value: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!isRuntimeModelTokenClaims(value)) throw new Error("Invalid runtime token");
    claims = value;
  } catch {
    throw new Error("Invalid runtime token");
  }
  if (
    !Number.isInteger(claims.userId) ||
    claims.userId <= 0 ||
    typeof claims.runtimeId !== "string" ||
    typeof claims.providerId !== "string" ||
    typeof claims.modelId !== "string" ||
    typeof claims.jti !== "string" ||
    !Number.isSafeInteger(claims.exp) ||
    claims.exp <= now
  )
    throw new Error("Expired runtime token");
  if (
    (scope.userId !== undefined && claims.userId !== scope.userId) ||
    (scope.runtimeId !== undefined && claims.runtimeId !== scope.runtimeId) ||
    claims.providerId !== scope.providerId
  )
    throw new Error("Runtime token scope mismatch");
  return claims;
}

export function runtimeTokenSecret(): string {
  const value =
    process.env.RUNTIME_MANAGER_SHARED_SECRET ?? process.env.CODEX_GATEWAY_CONFIG_SECRET ?? "";
  if (value === "" && process.env.NODE_ENV === "production")
    throw new Error("Runtime token secret is required in production");
  return value || "codex-gateway-development-runtime-token-secret";
}

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function sign(secret: string, payload: string): string {
  return createHmac("sha256", secret)
    .update(`${TOKEN_VERSION}.${payload}`, "utf8")
    .digest("base64url");
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function required(value: string): string {
  if (value.trim() === "") throw new Error("Runtime token field is required");
  return value;
}

function positiveId(value: number): number {
  if (!Number.isInteger(value) || value <= 0) throw new Error("Runtime token user ID is invalid");
  return value;
}

function isRuntimeModelTokenClaims(value: unknown): value is RuntimeModelTokenClaims {
  if (!isRecord(value)) return false;
  const record = value;
  return (
    typeof record.userId === "number" &&
    typeof record.runtimeId === "string" &&
    typeof record.providerId === "string" &&
    typeof record.modelId === "string" &&
    typeof record.jti === "string" &&
    typeof record.exp === "number"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
