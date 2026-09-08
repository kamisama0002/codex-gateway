import { createHash, randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { posix } from "node:path";
import type { CapabilityArtifact, CapabilityArtifactInput } from "~~/shared/types";
import { capabilityIdSchema } from "./schemas";
import { capabilityStore } from "./store";

const MAX_SKILL_BYTES = 1024 * 1024;
const ARTIFACT_ROOT = "/data/capabilities";

interface SkillArtifactStorePort {
  get(id: string): Promise<{ id: string; kind: string; version: string } | null>;
  upsertArtifact(input: CapabilityArtifactInput): Promise<CapabilityArtifact>;
}

interface SkillArtifactIo {
  mkdir(path: string, options: { recursive: true; mode: number }): Promise<unknown>;
  writeFile(path: string, content: Buffer, options: { mode: number }): Promise<unknown>;
  rename(from: string, to: string): Promise<unknown>;
  remove(path: string, options: { force: true }): Promise<unknown>;
  randomId(): string;
}

export class SkillArtifactWriter {
  constructor(
    private readonly store: SkillArtifactStorePort,
    private readonly io: SkillArtifactIo = {
      mkdir,
      writeFile,
      rename,
      remove: rm,
      randomId: randomUUID,
    },
  ) {}

  async write(capabilityId: string, content: Buffer) {
    if (content.byteLength === 0) throw new Error("Skill artifact is empty");
    if (content.byteLength > MAX_SKILL_BYTES) throw new Error("Skill artifact exceeds 1 MiB");
    const id = capabilityIdSchema.parse(capabilityId);
    const definition = await this.store.get(id);
    if (definition === null || definition.kind !== "skill") {
      throw new SkillArtifactWriterError("Skill capability not found", 404);
    }
    const directory = posix.join(ARTIFACT_ROOT, id, definition.version);
    const target = posix.join(directory, "SKILL.md");
    const temporary = `${target}.${this.io.randomId()}`;
    await this.io.mkdir(directory, { recursive: true, mode: 0o700 });
    try {
      await this.io.writeFile(temporary, content, { mode: 0o600 });
      await this.io.rename(temporary, target);
    } catch (error) {
      await this.io.remove(temporary, { force: true }).catch(() => undefined);
      throw error;
    }
    return await this.store.upsertArtifact({
      capabilityId: id,
      version: definition.version,
      sha256: createHash("sha256").update(content).digest("hex"),
      storagePath: target,
      sizeBytes: content.byteLength,
    });
  }
}

export class SkillArtifactWriterError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
  }
}

export const skillArtifactWriter = new SkillArtifactWriter(capabilityStore);
