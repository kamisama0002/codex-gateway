import { createHash, timingSafeEqual } from "node:crypto";
import net from "node:net";

const LISTEN_HOST = process.env.CODEX_BROWSER_PROXY_HOST ?? "0.0.0.0";
const LISTEN_PORT = Number(process.env.CODEX_BROWSER_PROXY_PORT ?? 6080);
const UPSTREAM_HOST = process.env.CODEX_BROWSER_UPSTREAM_HOST ?? "127.0.0.1";
const UPSTREAM_PORT = Number(process.env.CODEX_BROWSER_UPSTREAM_PORT ?? 6081);
const EXPECTED_TOKEN_SHA256 = process.env.CODEX_REMOTE_TOKEN_SHA256 ?? "";
const MAX_PREAMBLE_BYTES = 1024;

export function createBrowserProxyServer({
  expectedTokenSha256 = EXPECTED_TOKEN_SHA256,
  listenHost = LISTEN_HOST,
  listenPort = LISTEN_PORT,
  upstreamHost = UPSTREAM_HOST,
  upstreamPort = UPSTREAM_PORT,
} = {}) {
  if (!/^[a-f0-9]{64}$/u.test(expectedTokenSha256)) {
    throw new Error("CODEX_REMOTE_TOKEN_SHA256 is required for the browser proxy");
  }
  const server = net.createServer((client) => {
    let pending = Buffer.alloc(0);
    let authenticated = false;
    let upstream = null;
    let settled = false;

    const fail = () => {
      if (settled) return;
      settled = true;
      client.destroy();
      upstream?.destroy();
    };

    const connectUpstream = (payload) => {
      upstream = net.createConnection({ host: upstreamHost, port: upstreamPort });
      upstream.once("error", fail);
      upstream.once("close", () => {
        if (!client.destroyed) client.destroy();
      });
      client.once("error", fail);
      client.once("close", () => {
        if (!upstream?.destroyed) upstream?.destroy();
      });
      upstream.once("connect", () => {
        if (payload.length > 0) upstream?.write(payload);
        client.pipe(upstream).pipe(client);
        client.resume();
      });
    };

    client.on("data", (chunk) => {
      if (authenticated) return;
      pending = Buffer.concat([pending, Buffer.from(chunk)]);
      if (pending.length > MAX_PREAMBLE_BYTES) return fail();
      const newline = pending.indexOf(0x0a);
      if (newline < 0) return;
      const preamble = pending.subarray(0, newline + 1);
      const payload = pending.subarray(newline + 1);
      const token = parseBrowserPreamble(preamble);
      if (token === null || !tokenMatchesDigest(token, expectedTokenSha256)) return fail();
      authenticated = true;
      pending = Buffer.alloc(0);
      client.pause();
      connectUpstream(payload);
    });
  });
  server.listen(listenPort, listenHost);
  return server;
}

if (process.argv[1]?.endsWith("agent-runtime-browser-proxy.mjs")) {
  const server = createBrowserProxyServer();
  server.once("error", (error) => {
    console.error(`[agent-runtime-browser] proxy failed: ${error.message}`);
    process.exitCode = 1;
  });
  process.once("SIGTERM", () => server.close(() => process.exit(0)));
  process.once("SIGINT", () => server.close(() => process.exit(0)));
}

export function browserPreambleForToken(token) {
  return `BROWSER/1 ${token}\n`;
}

export function consumeBrowserPreamble(buffer, token) {
  if (!Buffer.isBuffer(buffer)) {
    return { authenticated: false, payload: null };
  }
  const newline = buffer.indexOf(0x0a);
  if (newline < 0 && buffer.length > MAX_PREAMBLE_BYTES) {
    return { authenticated: false, payload: null };
  }
  if (newline >= MAX_PREAMBLE_BYTES) {
    return { authenticated: false, payload: null };
  }
  if (newline < 0) return { authenticated: false, payload: null };
  const preamble = buffer.subarray(0, newline + 1);
  const parsed = parseBrowserPreamble(preamble);
  if (parsed === null || parsed !== token) return { authenticated: false, payload: null };
  return { authenticated: true, payload: buffer.subarray(newline + 1) };
}

function parseBrowserPreamble(value) {
  const text = Buffer.from(value).toString("utf8");
  const match = /^BROWSER\/1 ([A-Za-z0-9_-]{1,512})\n$/u.exec(text);
  return match?.[1] ?? null;
}

function tokenMatchesDigest(token, expected) {
  const actual = createHash("sha256").update(token, "utf8").digest();
  const target = Buffer.from(expected, "hex");
  return target.length === actual.length && timingSafeEqual(actual, target);
}
