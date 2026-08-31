import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const policyPath = fileURLToPath(
  new URL("../../../docker/agent-runtime-policy.json", import.meta.url),
);
const managerDockerfilePath = fileURLToPath(
  new URL("../../../docker/runtime-manager.Dockerfile", import.meta.url),
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
});
