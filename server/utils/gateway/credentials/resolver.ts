import type {
  CapabilityContext,
  DecryptedCredential,
  ResolvedRuntimeSecret,
} from "~~/shared/types";
import { credentialTargetSchema } from "./schemas";
import type { ExternalIssuerContext, ExternalIssuerDefinition } from "./external-issuer";

interface CredentialSecretReader {
  resolveSecretsForContext(
    context: CapabilityContext,
    capabilityIds: string[],
  ): Promise<DecryptedCredential[]>;
}

interface ExternalIssuerPort {
  issue(
    definition: ExternalIssuerDefinition,
    context: ExternalIssuerContext,
  ): Promise<{ token: string; expiresAt: string }>;
}

export class CredentialResolver {
  constructor(
    private readonly store: CredentialSecretReader,
    private readonly now: () => number = Date.now,
    private readonly externalIssuer?: ExternalIssuerPort,
  ) {}

  async resolveForRuntime(context: CapabilityContext, capabilityIds: string[]) {
    const credentials = await this.store.resolveSecretsForContext(context, capabilityIds);
    const targets = new Set<string>();
    const resolved: ResolvedRuntimeSecret[] = [];
    for (const credential of credentials) {
      if (!isActive(credential, this.now())) continue;
      const values = await this.runtimeValues(credential, context);
      for (const mapping of credential.mappings) {
        const target = credentialTargetSchema.parse(mapping.target);
        const targetId = targetKey(target);
        if (targets.has(targetId)) throw new Error("Credential target is assigned more than once");
        targets.add(targetId);
        const value = values[mapping.field];
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

  private async runtimeValues(credential: DecryptedCredential, context: CapabilityContext) {
    if (credential.kind !== "external_issuer") return credential.secret;
    if (this.externalIssuer === undefined)
      throw new Error("External credential issuer is unavailable");
    const url = credential.secret.issuerUrl;
    const audience = credential.secret.audience;
    if (url === undefined || audience === undefined) {
      throw new Error("External credential issuer configuration is incomplete");
    }
    const issued = await this.externalIssuer.issue(
      { url, audience, timeoutMs: 5_000 },
      {
        userId: context.userId,
        projectId: context.projectId,
        capabilityId: credential.capabilityId,
      },
    );
    return { token: issued.token };
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
