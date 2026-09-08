import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const DEFAULT_MAX_BYTES = 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 3;

type ResolveAddresses = (hostname: string) => Promise<string[]>;

interface SafeWebFetcherOptions {
  fetch?: typeof globalThis.fetch;
  resolve?: ResolveAddresses;
  maxBytes?: number;
  timeoutMs?: number;
}

export class SafeWebFetcher {
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly resolve: ResolveAddresses;
  private readonly maxBytes: number;
  private readonly timeoutMs: number;

  constructor(options: SafeWebFetcherOptions = {}) {
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.resolve = options.resolve ?? resolveHost;
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async fetchText(value: string) {
    let url = await assertPublicWebUrl(value, this.resolve);
    for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
      const response = await this.fetchImpl(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(this.timeoutMs),
        headers: { "user-agent": "codex-gateway-search-mcp/1.0" },
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (location === null || redirect === MAX_REDIRECTS) {
          throw new Error("Web fetch redirect limit exceeded");
        }
        url = await assertPublicWebUrl(new URL(location, url).toString(), this.resolve);
        continue;
      }
      if (!response.ok) throw new Error(`Web fetch failed with status ${response.status}`);
      const contentType = response.headers.get("content-type")?.split(";", 1)[0] ?? "text/plain";
      if (!isReadableContentType(contentType))
        throw new Error("Web fetch content type is not text");
      const contentLength = Number(response.headers.get("content-length"));
      if (Number.isFinite(contentLength) && contentLength > this.maxBytes) {
        throw new Error("Web fetch response is too large");
      }
      return {
        url,
        contentType,
        text: await readBoundedText(response, this.maxBytes),
      };
    }
    throw new Error("Web fetch redirect limit exceeded");
  }
}

export async function assertPublicWebUrl(value: string, resolve: ResolveAddresses = resolveHost) {
  const url = new URL(value);
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username !== "" ||
    url.password !== "" ||
    url.hash !== ""
  ) {
    throw new Error("Web fetch URL must be a public HTTP(S) URL");
  }
  const addresses = isIP(url.hostname) === 0 ? await resolve(url.hostname) : [url.hostname];
  if (addresses.length === 0 || addresses.some((address) => !isPublicAddress(address))) {
    throw new Error("Web fetch URL must resolve only to public addresses");
  }
  return url.toString();
}

async function resolveHost(hostname: string) {
  return (await lookup(hostname, { all: true, order: "verbatim" })).map((item) => item.address);
}

function isPublicAddress(address: string) {
  const version = isIP(address);
  if (version === 4) return isPublicIpv4(address);
  if (version !== 6) return false;
  const normalized = address.toLowerCase();
  if (normalized.startsWith("::ffff:")) return isPublicIpv4(normalized.slice(7));
  return !(
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    /^fe[89ab]/u.test(normalized) ||
    normalized.startsWith("ff") ||
    normalized.startsWith("2001:db8:")
  );
}

function isPublicIpv4(address: string) {
  const parts = address.split(".").map(Number);
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return false;
  }
  const [a = -1, b = -1, c = -1] = parts;
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
}

function isReadableContentType(value: string) {
  return (
    value.startsWith("text/") ||
    value === "application/json" ||
    value === "application/xml" ||
    value === "application/xhtml+xml"
  );
}

async function readBoundedText(response: Response, maxBytes: number) {
  if (response.body === null) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new Error("Web fetch response is too large");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}
