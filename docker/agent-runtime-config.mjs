import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const codexHome = nonEmptyEnvironment("CODEX_HOME") ?? "/codex-home";
const provider = providerConfiguration(process.env);
const websocketTokenSha256 = requiredSha256("CODEX_REMOTE_TOKEN_SHA256");

mkdirSync(codexHome, { mode: 0o700, recursive: true });
const userConfigPath = join(codexHome, "config.toml");
if (!existsSync(userConfigPath)) writeFileSync(userConfigPath, "", { flag: "wx", mode: 0o600 });

const args = [
  "app-server",
  "--enable",
  "apps",
  "--enable",
  "browser_use",
  "--enable",
  "memories",
  "--enable",
  "plugins",
  ...(provider === null ? [] : providerArguments(provider)),
  "--listen",
  "ws://0.0.0.0:4500",
  "--ws-auth",
  "capability-token",
  "--ws-token-sha256",
  websocketTokenSha256,
];

if (process.env.CODEX_RUNTIME_CONFIG_DRY_RUN === "1") {
  if (process.env.CODEX_REMOTE_TOKEN !== undefined) {
    throw new Error("CODEX_REMOTE_TOKEN must be cleared before launcher startup");
  }
  console.log(JSON.stringify(args));
} else {
  const childEnvironment = { ...process.env };
  delete childEnvironment.CODEX_REMOTE_TOKEN;
  delete childEnvironment.CODEX_REMOTE_TOKEN_SHA256;
  delete childEnvironment.CODEX_RUNTIME_CONFIG_DRY_RUN;
  delete childEnvironment.CODEX_RUNTIME_CONFIG_HELPER;

  const child = spawn("codex", args, { env: childEnvironment, stdio: "inherit" });
  const forwardSignal = (signal) => child.kill(signal);
  process.once("SIGINT", forwardSignal);
  process.once("SIGTERM", forwardSignal);
  child.once("error", (error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
  child.once("exit", (code) => {
    process.removeListener("SIGINT", forwardSignal);
    process.removeListener("SIGTERM", forwardSignal);
    process.exitCode = code ?? 1;
  });
}

/** @param {{ baseUrl: string, id: string, model: string }} provider */
function providerArguments(provider) {
  return [
    "-c",
    `model=${tomlString(provider.model)}`,
    "-c",
    'model_provider="codex_gateway"',
    "-c",
    `model_providers.codex_gateway.name=${tomlString(`Codex Gateway (${provider.id})`)}`,
    "-c",
    `model_providers.codex_gateway.base_url=${tomlString(provider.baseUrl)}`,
    "-c",
    'model_providers.codex_gateway.env_key="CODEX_GATEWAY_PROVIDER_TOKEN"',
    "-c",
    'model_providers.codex_gateway.wire_api="responses"',
    "-c",
    "model_providers.codex_gateway.request_max_retries=2",
    "-c",
    "model_providers.codex_gateway.stream_max_retries=2",
  ];
}

/**
 * @param {NodeJS.ProcessEnv} environment
 * @returns {{ baseUrl: string, id: string, model: string } | null}
 */
function providerConfiguration(environment) {
  const baseUrl = nonEmptyValue(environment.CODEX_GATEWAY_PROVIDER_BASE_URL);
  const id = nonEmptyValue(environment.CODEX_GATEWAY_PROVIDER_ID);
  const model = nonEmptyValue(environment.CODEX_GATEWAY_MODEL);
  const token = nonEmptyValue(environment.CODEX_GATEWAY_PROVIDER_TOKEN);
  if (baseUrl === null && id === null && model === null && token === null) return null;
  if (baseUrl === null || id === null || model === null || token === null) {
    throw new Error("Incomplete Gateway provider configuration");
  }
  if (!/^[a-z0-9][a-z0-9_-]{0,127}$/u.test(id)) {
    throw new Error("Gateway provider ID is invalid");
  }
  if (model.length > 256) throw new Error("Gateway model ID is too long");
  const url = new URL(baseUrl);
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error("Gateway provider base URL is invalid");
  }
  return { baseUrl: url.toString().replace(/\/$/u, ""), id, model };
}

/** @param {string} name */
function requiredSha256(name) {
  const value = nonEmptyEnvironment(name);
  if (value === null || !/^[a-f0-9]{64}$/u.test(value)) {
    throw new Error(`${name} must be a lowercase SHA-256 digest`);
  }
  return value;
}

/** @param {string} name */
function nonEmptyEnvironment(name) {
  return nonEmptyValue(process.env[name]);
}

/** @param {string | undefined} value */
function nonEmptyValue(value) {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === "" ? null : trimmed;
}

/** @param {string} value */
function tomlString(value) {
  return JSON.stringify(value);
}
