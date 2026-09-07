import { createHash, createHmac, randomUUID } from "node:crypto";

const baseUrl = requiredEnvironment("RUNTIME_MANAGER_BASE_URL").replace(/\/$/u, "");
const secret = requiredEnvironment("RUNTIME_MANAGER_SHARED_SECRET");
const runtimeId = requiredEnvironment("RUNTIME_SMOKE_RUNTIME_ID");
const userHash = requiredEnvironment("RUNTIME_SMOKE_USER_HASH");
const imageAlias = requiredEnvironment("RUNTIME_SMOKE_IMAGE_ALIAS");

const provisioned = await request("/v1/runtimes/provision", {
  imageAlias,
  runtimeId,
  runtimeType: "codex-app-server",
  userHash,
});
const started = await request("/v1/runtimes/start", { runtimeId });

console.log(
  JSON.stringify({
    containerId: requiredString(started, "containerId"),
    imageVersion: requiredString(started, "imageVersion"),
    provisionedStatus: requiredString(provisioned, "status"),
    runtimeId: requiredString(started, "runtimeId"),
    status: requiredString(started, "status"),
  }),
);

/** @param {string} path @param {Record<string, unknown>} payload */
async function request(path, payload) {
  const body = JSON.stringify(payload);
  const timestamp = Date.now();
  const nonce = randomUUID();
  const bodySha256 = createHash("sha256").update(body).digest("hex");
  const signature = createHmac("sha256", secret)
    .update(`POST\n${path}\n${timestamp}\n${nonce}\n${bodySha256}`)
    .digest("hex");
  const response = await fetch(`${baseUrl}${path}`, {
    body,
    headers: {
      "content-type": "application/json",
      "x-runtime-body-sha256": bodySha256,
      "x-runtime-nonce": nonce,
      "x-runtime-signature": signature,
      "x-runtime-timestamp": String(timestamp),
    },
    method: "POST",
  });
  /** @type {unknown} */
  const value = await response.json();
  if (!response.ok || !isRecord(value)) {
    throw new Error(`Runtime Manager ${path} failed with HTTP ${response.status}`);
  }
  return value;
}

/** @param {Record<string, unknown>} value @param {string} key */
function requiredString(value, key) {
  const field = value[key];
  if (typeof field !== "string" || field.length === 0) {
    throw new Error(`Runtime Manager response omitted ${key}`);
  }
  return field;
}

/** @param {string} name */
function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (value === undefined || value === "") throw new Error(`${name} is required`);
  return value;
}

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
