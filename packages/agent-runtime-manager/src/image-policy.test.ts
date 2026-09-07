import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { z } from "zod";

const policyPath = fileURLToPath(
  new URL("../../../docker/agent-runtime-policy.json", import.meta.url),
);
const agentDockerfilePath = fileURLToPath(
  new URL("../../../docker/agent-runtime.Dockerfile", import.meta.url),
);
const toolManifestPath = fileURLToPath(
  new URL("../../../docker/agent-runtime-tool-manifest.json", import.meta.url),
);
const nodeToolsPath = fileURLToPath(
  new URL("../../../docker/agent-runtime-node-tools.json", import.meta.url),
);
const pythonRequirementsPath = fileURLToPath(
  new URL("../../../docker/agent-runtime-python-requirements.txt", import.meta.url),
);
const managerDockerfilePath = fileURLToPath(
  new URL("../../../docker/runtime-manager.Dockerfile", import.meta.url),
);
const runnerDockerfilePath = fileURLToPath(
  new URL("../../../tests/e2e/runner.Dockerfile", import.meta.url),
);
const gatewaySupervisorPath = fileURLToPath(
  new URL("../../../tests/e2e/gateway-supervisor.sh", import.meta.url),
);
const e2eComposePath = fileURLToPath(
  new URL("../../../tests/e2e/docker-compose.yml", import.meta.url),
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
          "com.qiancheng.codex.version": "0.153.4",
        },
      },
    });
  });

  it("declares an executable full-runtime tool manifest with pinned dependencies", () => {
    expect(existsSync(toolManifestPath)).toBe(true);
    expect(existsSync(nodeToolsPath)).toBe(true);
    expect(existsSync(pythonRequirementsPath)).toBe(true);
    if (
      !existsSync(toolManifestPath) ||
      !existsSync(nodeToolsPath) ||
      !existsSync(pythonRequirementsPath)
    ) {
      return;
    }

    const toolManifest = z
      .object({
        commands: z.array(
          z
            .object({
              acceptedExitCodes: z.array(z.number().int()).default([0]),
              command: z.string().min(1),
              versionArgs: z.array(z.string()),
            })
            .strict(),
        ),
        pythonImports: z.array(z.string().min(1)),
      })
      .strict()
      .parse(JSON.parse(readFileSync(toolManifestPath, "utf8")));
    const commandNames = toolManifest.commands.map(({ command }) => command);
    expect(commandNames).toEqual(
      expect.arrayContaining([
        "git",
        "git-lfs",
        "gh",
        "ssh",
        "curl",
        "jq",
        "rg",
        "fd",
        "rsync",
        "python3",
        "uv",
        "node",
        "npm",
        "pnpm",
        "yarn",
        "bun",
        "tsc",
        "gcc",
        "clang",
        "cmake",
        "ninja",
        "go",
        "cargo",
        "java",
        "mvn",
        "gradle",
        "sqlite3",
        "psql",
        "mysql",
        "redis-cli",
        "libreoffice",
        "pandoc",
        "pdftotext",
        "gs",
        "convert",
        "ffmpeg",
        "tesseract",
        "chromium",
        "chromedriver",
        "playwright",
        "playwright-mcp",
        "docker",
        "codex",
      ]),
    );
    expect(
      toolManifest.commands.find(({ command }) => command === "nc")?.acceptedExitCodes,
    ).toEqual([0, 1]);
    expect(toolManifest.pythonImports).toEqual(
      expect.arrayContaining([
        "numpy",
        "pandas",
        "polars",
        "pyarrow",
        "scipy",
        "sklearn",
        "matplotlib",
        "seaborn",
        "requests",
        "httpx",
        "sqlalchemy",
        "openpyxl",
        "docx",
        "pptx",
        "pypdf",
        "pdfplumber",
        "PIL",
      ]),
    );

    const nodeTools = z
      .object({ packages: z.record(z.string().min(1), z.string().regex(/^\d+\.\d+\.\d+/)) })
      .strict()
      .parse(JSON.parse(readFileSync(nodeToolsPath, "utf8")));
    expect(nodeTools.packages).toMatchObject({
      "@openai/codex": "0.153.4",
      "@playwright/mcp": "0.0.80",
      "@playwright/test": "1.63.0",
      bun: "1.4.2",
      typescript: "7.0.2",
      yarn: "1.22.22",
    });

    const requirements = readFileSync(pythonRequirementsPath, "utf8")
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line !== "" && !line.startsWith("#"));
    expect(requirements.length).toBeGreaterThan(10);
    expect(requirements.every((line) => /^[A-Za-z0-9_.-]+==[^=\s]+$/u.test(line))).toBe(true);
    expect(readFileSync(agentDockerfilePath, "utf8")).toContain(" AS full");
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

  it("restarts the Gateway child and forwards supervisor shutdown without changing namespaces", () => {
    expect(existsSync(gatewaySupervisorPath)).toBe(true);
    const fixtureDirectory = mkdtempSync(join(tmpdir(), "codex-gateway-supervisor-"));
    const fakeChildPath = join(fixtureDirectory, "fake-gateway-child.sh");
    const eventsPath = join(fixtureDirectory, "events.txt");
    writeFileSync(
      fakeChildPath,
      [
        "#!/bin/sh",
        "set -eu",
        'events="$1"',
        'count_file="${events}.count"',
        "count=0",
        'if [ -f "$count_file" ]; then count="$(cat "$count_file")"; fi',
        "count=$((count + 1))",
        'printf "%s\\n" "$count" > "$count_file"',
        'printf "start:%s\\n" "$count" >> "$events"',
        'if [ "$count" -eq 1 ]; then exit 23; fi',
        'trap \'printf "%s\\n" child-term >> "$events"; exit 0\' TERM INT',
        "while :; do sleep 1; done",
      ].join("\n"),
      { mode: 0o755 },
    );
    chmodSync(fakeChildPath, 0o755);

    try {
      const shell = process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "/bin/sh";
      const result = spawnSync(
        shell,
        [
          "-c",
          [
            "set -eu",
            'supervisor="$1"',
            'child="$2"',
            'events="$3"',
            '"$supervisor" "$child" "$events" &',
            "supervisor_pid=$!",
            "ready=0",
            "for _ in $(seq 1 100); do",
            '  if [ -f "$events" ] && grep -q "^start:2$" "$events"; then ready=1; break; fi',
            "  sleep 0.05",
            "done",
            'if [ "$ready" -ne 1 ]; then kill -TERM "$supervisor_pid" 2>/dev/null || true; wait "$supervisor_pid" || true; exit 1; fi',
            'kill -TERM "$supervisor_pid"',
            'wait "$supervisor_pid"',
            'grep -q "^child-term$" "$events"',
          ].join("\n"),
          "gateway-supervisor-test",
          shellPath(gatewaySupervisorPath),
          shellPath(fakeChildPath),
          shellPath(eventsPath),
        ],
        { encoding: "utf8" },
      );
      expect(result.status, result.stderr).toBe(0);
      expect(readFileSync(eventsPath, "utf8").trim().split("\n")).toEqual([
        "start:1",
        "start:2",
        "child-term",
      ]);

      const runnerDockerfile = readFileSync(runnerDockerfilePath, "utf8");
      expect(runnerDockerfile).toContain(
        "COPY tests/e2e/gateway-supervisor.sh /usr/local/bin/codex-gateway-e2e-supervisor",
      );
      const compose = readFileSync(e2eComposePath, "utf8").replace(/\s+/g, " ");
      expect(compose).toContain(
        'command: ["/usr/local/bin/codex-gateway-e2e-supervisor", "node", "--expose-gc", "--max-old-space-size=512", "/e2e-output/server/index.mjs"]',
      );
    } finally {
      rmSync(fixtureDirectory, { force: true, recursive: true });
    }
  });

  it("builds App Server arguments with a derived capability-token digest and no raw token", () => {
    const fixtureDirectory = mkdtempSync(join(tmpdir(), "codex-agent-entrypoint-"));
    const fakeNodePath = join(fixtureDirectory, "node");
    const token = "test-only-random-service-token";
    writeFileSync(
      fakeNodePath,
      ["#!/bin/sh", "set -eu", `exec \"${shellPath(process.execPath)}\" \"$@\"`].join("\n"),
      { mode: 0o755 },
    );
    chmodSync(fakeNodePath, 0o755);

    try {
      const shell = process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "/bin/sh";
      const shellFixtureDirectory = shellPath(fixtureDirectory);
      const result = spawnSync(shell, [shellPath(agentEntrypointPath)], {
        encoding: "utf8",
        env: {
          ...process.env,
          CODEX_HOME: shellFixtureDirectory,
          CODEX_REMOTE_TOKEN: token,
          CODEX_RUNTIME_CONFIG_HELPER: shellPath(
            fileURLToPath(new URL("../../../docker/agent-runtime-config.mjs", import.meta.url)),
          ),
          CODEX_RUNTIME_CONFIG_DRY_RUN: "1",
          PATH: `${shellFixtureDirectory}:/usr/bin:/bin`,
        },
      });
      expect(result.status, result.stderr).toBe(0);
      const captured = z.array(z.string()).parse(JSON.parse(result.stdout));
      expect(captured).toEqual([
        "app-server",
        "--enable",
        "apps",
        "--enable",
        "browser_use",
        "--enable",
        "memories",
        "--enable",
        "plugins",
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
      expect(entrypoint).toContain("unset CODEX_REMOTE_TOKEN");
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
