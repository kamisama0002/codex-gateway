import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";

const configScriptPath = fileURLToPath(
  new URL("../../docker/agent-runtime-config.mjs", import.meta.url),
);
const tempDirectories: string[] = [];

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("Agent runtime managed Codex profile", () => {
  it("preserves user config and emits token-free App Server overrides", () => {
    const codexHome = temporaryDirectory("codex-runtime-config-");
    const userConfig = ["[mcp_servers.user_server]", 'url = "https://mcp.example.test"', ""].join(
      "\n",
    );
    writeFileSync(join(codexHome, "config.toml"), userConfig, { mode: 0o600 });
    const providerToken = "provider-token-must-not-be-written";

    const result = runConfigScript(codexHome, {
      CODEX_GATEWAY_MODEL: "gpt-5.6-sol",
      CODEX_GATEWAY_PROVIDER_BASE_URL: "http://codex-gateway:3000/api/internal/providers/gpt/v1",
      CODEX_GATEWAY_PROVIDER_ID: "gpt",
      CODEX_GATEWAY_PROVIDER_TOKEN: providerToken,
    });

    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(join(codexHome, "config.toml"), "utf8")).toBe(userConfig);
    const args = z.array(z.string()).parse(JSON.parse(result.stdout));
    expect(args).toEqual(
      expect.arrayContaining([
        "app-server",
        "apps",
        "browser_use",
        "memories",
        "plugins",
        'model="gpt-5.6-sol"',
        'model_provider="codex_gateway"',
        'model_providers.codex_gateway.env_key="CODEX_GATEWAY_PROVIDER_TOKEN"',
        'model_providers.codex_gateway.wire_api="responses"',
      ]),
    );
    expect(args.join("\n")).not.toContain(providerToken);

    const second = runConfigScript(codexHome, {
      CODEX_GATEWAY_MODEL: "gpt-5.6-sol",
      CODEX_GATEWAY_PROVIDER_BASE_URL: "http://codex-gateway:3000/api/internal/providers/gpt/v1",
      CODEX_GATEWAY_PROVIDER_ID: "gpt",
      CODEX_GATEWAY_PROVIDER_TOKEN: providerToken,
    });
    expect(second.status, second.stderr).toBe(0);
    expect(readFileSync(join(codexHome, "config.toml"), "utf8")).toBe(userConfig);
    expect(z.array(z.string()).parse(JSON.parse(second.stdout))).toEqual(args);
  });

  it("rejects incomplete provider configuration without changing user config", () => {
    const codexHome = temporaryDirectory("codex-runtime-config-invalid-");
    const userConfigPath = join(codexHome, "config.toml");
    writeFileSync(userConfigPath, "manual = true\n", { mode: 0o600 });

    const result = runConfigScript(codexHome, {
      CODEX_GATEWAY_PROVIDER_BASE_URL: "https://mcp.example.test/v1",
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Incomplete Gateway provider configuration");
    expect(readFileSync(userConfigPath, "utf8")).toBe("manual = true\n");
  });

  it("consumes environment secrets without printing them and preserves file targets", () => {
    const codexHome = temporaryDirectory("codex-runtime-config-secret-home-");
    const secretDirectory = temporaryDirectory("codex-runtime-config-secrets-");
    const exactSecret = "exact-environment-secret";
    writeFileSync(join(secretDirectory, ".env-0"), exactSecret, { mode: 0o600 });
    writeFileSync(join(secretDirectory, "business-key"), "private-key", { mode: 0o600 });
    writeFileSync(
      join(secretDirectory, "manifest.json"),
      JSON.stringify({ environment: { BUSINESS_TOKEN: ".env-0" } }),
      { mode: 0o600 },
    );
    writeFileSync(join(secretDirectory, ".ready"), "", { mode: 0o600 });

    const result = runConfigScript(codexHome, {
      CODEX_RUNTIME_SECRET_DIR: secretDirectory,
    });

    expect(result.status, result.stderr).toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).not.toContain(exactSecret);
    expect(existsSync(join(secretDirectory, ".env-0"))).toBe(false);
    expect(existsSync(join(secretDirectory, "manifest.json"))).toBe(false);
    expect(existsSync(join(secretDirectory, ".ready"))).toBe(false);
    expect(readFileSync(join(secretDirectory, "business-key"), "utf8")).toBe("private-key");
  });
});

function runConfigScript(codexHome: string, environment: Record<string, string>) {
  return spawnSync(process.execPath, [configScriptPath], {
    encoding: "utf8",
    env: {
      ...process.env,
      ...environment,
      CODEX_HOME: codexHome,
      CODEX_REMOTE_TOKEN_SHA256: "a".repeat(64),
      CODEX_RUNTIME_CONFIG_DRY_RUN: "1",
    },
  });
}

function temporaryDirectory(prefix: string) {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  tempDirectories.push(directory);
  return directory;
}
