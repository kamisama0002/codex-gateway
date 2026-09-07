import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { SUPPORTED_CODEX_VERSION } from "./codex-version";

const agentDockerfilePath = fileURLToPath(
  new URL("../../../../../docker/agent-runtime.Dockerfile", import.meta.url),
);
const policyPath = fileURLToPath(
  new URL("../../../../../docker/agent-runtime-policy.json", import.meta.url),
);

const imagePolicySchema = z.object({
  agent: z.object({
    image: z.string(),
    labels: z.record(z.string(), z.string()),
  }),
});

describe("supported Codex version", () => {
  it("matches the managed Agent image and policy", () => {
    const policy = imagePolicySchema.parse(JSON.parse(readFileSync(policyPath, "utf8")));
    const dockerfile = readFileSync(agentDockerfilePath, "utf8");

    expect(SUPPORTED_CODEX_VERSION).toBe("0.153.4");
    expect(policy.agent.image).toBe("codex-agent-runtime:0.153.4");
    expect(policy.agent.labels["com.qiancheng.codex.version"]).toBe("0.153.4");
    expect(dockerfile).toContain("@openai/codex@0.153.4");
  });
});
