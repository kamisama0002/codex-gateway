import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const policyPath = fileURLToPath(
  new URL("../../../docker/agent-runtime-policy.json", import.meta.url),
);
const managerDockerfilePath = fileURLToPath(
  new URL("../../../docker/runtime-manager.Dockerfile", import.meta.url),
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
      "pnpm --filter @codex-gateway/agent-runtime-contracts typecheck",
    );
    expect(dockerfile).toContain("pnpm --filter @codex-gateway/agent-runtime-manager build");
  });
});
