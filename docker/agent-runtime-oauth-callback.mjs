const callbackPort = Number(process.env.CODEX_MCP_OAUTH_CALLBACK_PORT ?? "1456");
if (!Number.isInteger(callbackPort) || callbackPort < 1 || callbackPort > 65_535) {
  throw new Error("MCP OAuth callback port is invalid");
}
const chunks = [];
let size = 0;
for await (const chunk of process.stdin) {
  const bytes = Buffer.from(chunk);
  size += bytes.byteLength;
  if (size > 32 * 1024) throw new Error("MCP OAuth callback is too large");
  chunks.push(bytes);
}
const input = Buffer.concat(chunks);
let pathAndQuery;
try {
  pathAndQuery = input.toString("utf8");
} finally {
  input.fill(0);
  chunks.forEach((chunk) => chunk.fill(0));
}
const callback = new URL(pathAndQuery, `http://127.0.0.1:${callbackPort}`);
if (
  callback.origin !== `http://127.0.0.1:${callbackPort}` ||
  callback.pathname !== "/api/capabilities/mcp/oauth/callback" ||
  callback.hash !== "" ||
  !callback.searchParams.has("state") ||
  (!callback.searchParams.has("code") && !callback.searchParams.has("error"))
) {
  throw new Error("MCP OAuth callback is invalid");
}
const response = await fetch(callback, { redirect: "manual" });
if (response.status < 200 || response.status >= 400) {
  throw new Error("MCP OAuth callback listener rejected the request");
}
