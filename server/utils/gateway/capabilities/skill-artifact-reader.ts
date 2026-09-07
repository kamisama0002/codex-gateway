import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { posix } from "node:path";
import type { CapabilityChange } from "~~/shared/types";
import type { CapabilityStore } from "./store";

type InstallSkillChange = Extract<CapabilityChange, { operation: "installSkill" }>;

export class StoredSkillArtifactReader {
  constructor(
    private readonly store: Pick<CapabilityStore, "getArtifact">,
    private readonly read: (path: string) => Promise<Buffer> = readFile,
  ) {}

  async readSkill(change: InstallSkillChange) {
    const artifact = await this.store.getArtifact(change.capabilityId, change.version);
    if (artifact === null) throw new Error("Skill artifact not found");
    const path = artifact.storagePath;
    if (
      posix.normalize(path) !== path ||
      !path.startsWith(`/data/capabilities/${change.capabilityId}/`) ||
      !path.endsWith("/SKILL.md")
    ) {
      throw new Error("Skill artifact must be stored as a direct SKILL.md file");
    }
    const content = await this.read(path);
    if (content.byteLength !== artifact.sizeBytes) {
      throw new Error("Skill artifact size does not match the catalog");
    }
    const digest = createHash("sha256").update(content).digest("hex");
    if (digest !== artifact.sha256) throw new Error("Skill artifact digest does not match");
    return content;
  }
}
