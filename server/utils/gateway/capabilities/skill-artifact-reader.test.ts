import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { CapabilityChange } from "~~/shared/types";
import { StoredSkillArtifactReader } from "./skill-artifact-reader";

const change = {
  operation: "installSkill",
  capabilityId: "org__revenue",
  source: { type: "upload", locator: "artifact:org__revenue/1" },
  version: "1",
  targetDirectory: "/codex-home/skills/org__revenue/1",
  targetPath: "/codex-home/skills/org__revenue/1/SKILL.md",
} satisfies CapabilityChange;

describe("StoredSkillArtifactReader", () => {
  it("reads a direct SKILL.md artifact only after size and digest verification", async () => {
    const content = Buffer.from("---\nname: org__revenue\n---\n", "utf8");
    const readFile = vi.fn(async () => content);
    const reader = new StoredSkillArtifactReader(
      {
        getArtifact: async () => ({
          capabilityId: "org__revenue",
          version: "1",
          sha256: createHash("sha256").update(content).digest("hex"),
          storagePath: "/data/capabilities/org__revenue/1/SKILL.md",
          sizeBytes: content.byteLength,
          createdAt: "2026-09-07T00:00:00.000Z",
        }),
      },
      readFile,
    );

    await expect(reader.readSkill(change)).resolves.toEqual(content);
    expect(readFile).toHaveBeenCalledWith("/data/capabilities/org__revenue/1/SKILL.md");
  });

  it("rejects archives, missing artifacts, and changed bytes", async () => {
    const archiveReader = new StoredSkillArtifactReader(
      {
        getArtifact: async () => ({
          capabilityId: "org__revenue",
          version: "1",
          sha256: "a".repeat(64),
          storagePath: "/data/capabilities/org__revenue/1.tar.gz",
          sizeBytes: 1,
          createdAt: "2026-09-07T00:00:00.000Z",
        }),
      },
      async () => Buffer.from("x"),
    );
    const missingReader = new StoredSkillArtifactReader(
      { getArtifact: async () => null },
      async () => Buffer.from("x"),
    );
    const changedReader = new StoredSkillArtifactReader(
      {
        getArtifact: async () => ({
          capabilityId: "org__revenue",
          version: "1",
          sha256: "a".repeat(64),
          storagePath: "/data/capabilities/org__revenue/1/SKILL.md",
          sizeBytes: 1,
          createdAt: "2026-09-07T00:00:00.000Z",
        }),
      },
      async () => Buffer.from("x"),
    );

    await expect(archiveReader.readSkill(change)).rejects.toThrow("direct SKILL.md");
    await expect(missingReader.readSkill(change)).rejects.toThrow("not found");
    await expect(changedReader.readSkill(change)).rejects.toThrow("digest");
  });
});
