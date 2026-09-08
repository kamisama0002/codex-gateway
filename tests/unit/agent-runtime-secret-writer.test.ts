import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";

const writerPath = fileURLToPath(
  new URL("../../docker/agent-runtime-secret-writer.mjs", import.meta.url),
);
const tempDirectories: string[] = [];

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) rmSync(directory, { recursive: true });
});

describe("Agent runtime secret writer", () => {
  it("atomically writes env indirection and direct files without outputting values", () => {
    const directory = mkdtempSync(join(tmpdir(), "codex-runtime-secrets-"));
    tempDirectories.push(directory);
    const environmentSecret = "writer-environment-secret";
    const fileSecret = "writer-file-secret";
    const result = spawnSync(process.execPath, [writerPath], {
      encoding: "utf8",
      input: JSON.stringify({
        runtimeSecrets: [
          {
            credentialId: "cred__env",
            capabilityId: "org__business",
            version: 1,
            target: { type: "env", name: "BUSINESS_TOKEN" },
            value: environmentSecret,
          },
          {
            credentialId: "cred__file",
            capabilityId: "org__business",
            version: 1,
            target: { type: "file", path: "/run/codex-secrets/business-key" },
            value: fileSecret,
          },
        ],
      }),
      env: { ...process.env, CODEX_RUNTIME_SECRET_DIR: directory },
    });

    expect(result.status, result.stderr).toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).not.toContain(environmentSecret);
    expect(`${result.stdout}\n${result.stderr}`).not.toContain(fileSecret);
    expect(readFileSync(join(directory, "business-key"), "utf8")).toBe(fileSecret);
    const manifest = z
      .object({ environment: z.record(z.string(), z.string()) })
      .strict()
      .parse(JSON.parse(readFileSync(join(directory, "manifest.json"), "utf8")) as unknown);
    expect(manifest).toEqual({ environment: { BUSINESS_TOKEN: ".env-0" } });
    expect(readFileSync(join(directory, ".env-0"), "utf8")).toBe(environmentSecret);
    expect(existsSync(join(directory, ".ready"))).toBe(true);
  });

  it("rejects nested and duplicate targets without writing readiness", () => {
    const directory = mkdtempSync(join(tmpdir(), "codex-runtime-secrets-invalid-"));
    tempDirectories.push(directory);
    const result = spawnSync(process.execPath, [writerPath], {
      encoding: "utf8",
      input: JSON.stringify({
        runtimeSecrets: [
          {
            credentialId: "cred__bad",
            capabilityId: "org__business",
            version: 1,
            target: { type: "file", path: "/run/codex-secrets/nested/key" },
            value: "secret",
          },
        ],
      }),
      env: { ...process.env, CODEX_RUNTIME_SECRET_DIR: directory },
    });

    expect(result.status).not.toBe(0);
    expect(existsSync(join(directory, ".ready"))).toBe(false);
  });
});
