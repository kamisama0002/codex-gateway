import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { CapabilityArtifactInput } from "~~/shared/types";
import { SkillArtifactWriter } from "./skill-artifact-writer";

describe("SkillArtifactWriter", () => {
  it("writes a direct SKILL.md atomically and records its verified digest", async () => {
    const content = Buffer.from("---\nname: org__revenue\n---\n", "utf8");
    const upsertArtifact = vi.fn(async (input: CapabilityArtifactInput) => ({
      ...input,
      createdAt: "now",
    }));
    const mkdir = vi.fn(async () => undefined);
    const writeFile = vi.fn(async () => undefined);
    const rename = vi.fn(async () => undefined);
    const writer = new SkillArtifactWriter(
      {
        get: vi.fn(async () => ({
          id: "org__revenue",
          kind: "skill",
          version: "1.0.0",
        })),
        upsertArtifact,
      },
      { mkdir, writeFile, rename, remove: vi.fn(async () => undefined), randomId: () => "tmp" },
    );

    await expect(writer.write("org__revenue", content)).resolves.toMatchObject({
      capabilityId: "org__revenue",
      version: "1.0.0",
      storagePath: "/data/capabilities/org__revenue/1.0.0/SKILL.md",
      sizeBytes: content.byteLength,
      sha256: createHash("sha256").update(content).digest("hex"),
    });
    expect(writeFile).toHaveBeenCalledWith(
      "/data/capabilities/org__revenue/1.0.0/SKILL.md.tmp",
      content,
      { mode: 0o600 },
    );
    expect(rename).toHaveBeenCalledWith(
      "/data/capabilities/org__revenue/1.0.0/SKILL.md.tmp",
      "/data/capabilities/org__revenue/1.0.0/SKILL.md",
    );
  });

  it("rejects non-Skill definitions and oversized content before writing", async () => {
    const writeFile = vi.fn();
    const writer = new SkillArtifactWriter(
      {
        get: vi.fn(async () => ({ id: "org__app", kind: "app", version: "1.0.0" })),
        upsertArtifact: vi.fn(),
      },
      {
        mkdir: vi.fn(),
        writeFile,
        rename: vi.fn(),
        remove: vi.fn(),
        randomId: () => "tmp",
      },
    );

    await expect(writer.write("org__app", Buffer.from("content"))).rejects.toThrow(/Skill/);
    await expect(writer.write("org__app", Buffer.alloc(1024 * 1024 + 1))).rejects.toThrow(/1 MiB/);
    expect(writeFile).not.toHaveBeenCalled();
  });
});
