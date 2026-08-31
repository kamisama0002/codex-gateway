import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const policyPath = fileURLToPath(
  new URL("../../../docker/agent-runtime-policy.json", import.meta.url),
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
});
