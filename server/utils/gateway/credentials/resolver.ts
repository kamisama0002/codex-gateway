import type {
  CapabilityContext,
  DecryptedCredential,
  ResolvedRuntimeSecret,
} from "~~/shared/types";
import { credentialTargetSchema } from "./schemas";

interface CredentialSecretReader {
  resolveSecretsForContext(
    context: CapabilityContext,
    capabilityIds: string[],
  ): Promise<DecryptedCredential[]>;
}

export class CredentialResolver {
  constructor(
    private readonly store: CredentialSecretReader,
    private readonly now: () => number = Date.now,
  ) {}

  async resolveForRuntime(context: CapabilityContext, capabilityIds: string[]) {
    const credentials = await this.store.resolveSecretsForContext(context, capabilityIds);
    const targets = new Set<string>();
    const resolved: ResolvedRuntimeSecret[] = [];
    for (const credential of credentials) {
      if (!isActive(credential, this.now())) continue;
      for (const mapping of credential.mappings) {
        const target = credentialTargetSchema.parse(mapping.target);
        const targetId = targetKey(target);
        if (targets.has(targetId)) throw new Error("Credential target is assigned more than once");
        targets.add(targetId);
        const value = credential.secret[mapping.field];
        if (value === undefined || value === "") {
          throw new Error("Credential mapping value is missing");
        }
        resolved.push({
          credentialId: credential.id,
          capabilityId: credential.capabilityId,
          version: credential.version,
          target,
          value,
        });
      }
    }
    return resolved.sort((left, right) =>
      targetKey(left.target).localeCompare(targetKey(right.target)),
    );
  }
}

function isActive(credential: DecryptedCredential, now: number) {
  if (credential.revokedAt !== null) return false;
  if (credential.notBefore !== null && Date.parse(credential.notBefore) > now) return false;
  return credential.expiresAt === null || Date.parse(credential.expiresAt) > now;
}

function targetKey(target: ResolvedRuntimeSecret["target"]) {
  return target.type === "env" ? target.name : target.path;
}
