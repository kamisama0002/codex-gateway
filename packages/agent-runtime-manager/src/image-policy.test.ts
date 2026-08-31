import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const policyPath = fileURLToPath(
  new URL("../../../docker/agent-runtime-policy.json", import.meta.url),
);
const managerDockerfilePath = fileURLToPath(
  new URL("../../../docker/runtime-manager.Dockerfile", import.meta.url),
);
const runnerDockerfilePath = fileURLToPath(
  new URL("../../../tests/e2e/runner.Dockerfile", import.meta.url),
);
const agentEntrypointPath = fileURLToPath(
  new URL("../../../docker/agent-runtime-entrypoint.sh", import.meta.url),
);
const contractsPackagePath = fileURLToPath(
  new URL("../../agent-runtime-contracts/package.json", import.meta.url),
);
const contractsTsconfigPath = fileURLToPath(
  new URL("../../agent-runtime-contracts/tsconfig.json", import.meta.url),
);
const isolatedContractsTsconfigPath = fileURLToPath(
  new URL("../../agent-runtime-contracts/tsconfig.runtime-manager.json", import.meta.url),
);

describe("Agent runtime image policy", () => {
  it("keeps the Agent image isolated and pinned", () => {
    const policy: unknown = JSON.parse(readFileSync(policyPath, "utf8"));

    expect(policy).toMatchObject({
      agent: {
        appServer: {
          command: [
            "codex",
            "app-server",
            "--listen",
            "ws://0.0.0.0:4500",
            "--ws-auth",
            "capability-token",
            "--ws-token-sha256",
            "<sha256(CODEX_REMOTE_TOKEN)>",
          ],
        },
        capDrop: ["ALL"],
        publishedPorts: [],
        readOnlyRootFilesystem: true,
        user: "10001:10001",
        labels: {
          "com.qiancheng.codex.version": "0.151.0",
        },
      },
    });
  });

  it("builds only the Runtime Manager package graph after suppressing root lifecycle scripts", () => {
    const dockerfile = readFileSync(managerDockerfilePath, "utf8").replaceAll("\\\n", " ");
    const contractsPackage = JSON.parse(readFileSync(contractsPackagePath, "utf8")) as {
      scripts?: Record<string, string>;
    };

    expect(contractsPackage.scripts?.typecheck).toBe("tsc --noEmit");
    expect(contractsPackage.scripts?.["typecheck:runtime-manager"]).toBe(
      "tsc --noEmit -p tsconfig.runtime-manager.json",
    );
    const fullTsconfig = JSON.parse(readFileSync(contractsTsconfigPath, "utf8")) as {
      exclude?: string[];
      include?: string[];
    };
    expect(fullTsconfig.include).toEqual(["src/**/*.ts"]);
    expect(fullTsconfig.exclude).toBeUndefined();
    expect(dockerfile).toContain(
      "pnpm install --frozen-lockfile --ignore-scripts --filter @codex-gateway/agent-runtime-manager...",
    );
    expect(dockerfile).toContain(
      "pnpm --filter @codex-gateway/agent-runtime-manager rebuild esbuild",
    );
    expect(dockerfile).toContain(
      "pnpm --filter @codex-gateway/agent-runtime-manager exec esbuild --version",
    );
    expect(dockerfile).toContain(
      "pnpm --filter @codex-gateway/agent-runtime-contracts typecheck:runtime-manager",
    );
    expect(dockerfile).toContain("pnpm --filter @codex-gateway/agent-runtime-manager build");

    const isolatedTsconfig = JSON.parse(readFileSync(isolatedContractsTsconfigPath, "utf8")) as {
      files?: string[];
      include?: string[];
    };
    expect(isolatedTsconfig.files).toEqual(["src/index.ts"]);
    expect(isolatedTsconfig.include).toEqual([]);
  });

  it("copies the Contracts root dependency before the cached E2E runner install", () => {
    const dockerfile = readFileSync(runnerDockerfilePath, "utf8");
    const packageSources = dockerfile.indexOf("COPY packages ./packages");
    const sharedSources = dockerfile.indexOf("COPY shared ./shared");
    const frozenInstall = dockerfile.indexOf("pnpm install --frozen-lockfile");
    const mutableSources = dockerfile.indexOf("COPY . /workspace/source");

    expect(packageSources).toBeGreaterThanOrEqual(0);
    expect(sharedSources).toBeGreaterThan(packageSources);
    expect(sharedSources).toBeLessThan(frozenInstall);
    expect(mutableSources).toBeGreaterThan(frozenInstall);
  });

  it("starts App Server with a derived capability-token digest and no raw token", () => {
    const fixtureDirectory = mkdtempSync(join(tmpdir(), "codex-agent-entrypoint-"));
    const fakeCodexPath = join(fixtureDirectory, "codex");
    const capturePath = join(fixtureDirectory, "capture.txt");
    const token = "test-only-random-service-token";
    writeFileSync(
      fakeCodexPath,
      [
        "#!/bin/sh",
        "set -eu",
        'if [ "${CODEX_REMOTE_TOKEN+x}" = x ]; then',
        "  printf '%s\\n' token-present",
        "else",
        "  printf '%s\\n' token-unset",
        "fi > \"$E2E_CAPTURE_PATH\"",
        'for argument in "$@"; do',
        "  printf '%s\\n' \"$argument\" >> \"$E2E_CAPTURE_PATH\"",
        "done",
      ].join("\n"),
      { mode: 0o755 },
    );
    chmodSync(fakeCodexPath, 0o755);

    try {
      const shell =
        process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "/bin/sh";
      const shellFixtureDirectory = shellPath(fixtureDirectory);
      const result = spawnSync(shell, [shellPath(agentEntrypointPath)], {
        encoding: "utf8",
        env: {
          ...process.env,
          CODEX_REMOTE_TOKEN: token,
          E2E_CAPTURE_PATH: `${shellFixtureDirectory}/capture.txt`,
          PATH: `${shellFixtureDirectory}:/usr/bin:/bin`,
        },
      });
      expect(result.status, result.stderr).toBe(0);
      const captured = readFileSync(capturePath, "utf8").trim().split("\n");
      expect(captured).toEqual([
        "token-unset",
        "app-server",
        "--listen",
        "ws://0.0.0.0:4500",
        "--ws-auth",
        "capability-token",
        "--ws-token-sha256",
        createHash("sha256").update(token).digest("hex"),
      ]);
      expect(captured).not.toContain(token);

      const entrypoint = readFileSync(agentEntrypointPath, "utf8");
      expect(entrypoint).not.toContain("--remote-auth-token-env");
      expect(entrypoint).not.toContain("--ws-token-file");
      expect(entrypoint).toContain('unset CODEX_REMOTE_TOKEN');
    } finally {
      rmSync(fixtureDirectory, { force: true, recursive: true });
    }
  });
});

function shellPath(path: string) {
  const normalized = path.replaceAll("\\", "/");
  if (process.platform !== "win32") return normalized;
  return normalized.replace(/^([A-Za-z]):/, (_, drive: string) => `/${drive.toLowerCase()}`);
}
